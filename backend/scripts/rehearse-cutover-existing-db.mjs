// بروفة الانتقال من `prisma db push` إلى `prisma migrate deploy` على قاعدة موجودة معزولة:
// فرع Neon منسوخ من الإنتاج، أو القاعدة المحلية بشكل الإنتاج التي يبنيها CI.
//
// الأمان:
// - يرفض نقطة اتصال الإنتاج (ep-flat-scene-a58qzr72) بأي صيغة، ويرفض قاعدة فيها _prisma_migrations مسبقًا.
// - لا يطبع أي صف: أعداد وبصمات md5 وقيم منطقية فقط.
// - اختبارا الرفض (تعديل تقييم، تقييم 9) داخل معاملة تُلغى دائمًا.
// - يحتاج REHEARSAL_DATABASE_URL في متغير بيئة مؤقت، لا في ملف.
//
// التشغيل (من مجلد backend بعد npm ci && npm run prisma:generate):
//   REHEARSAL_DATABASE_URL="<رابط فرع Neon المعزول>" node scripts/rehearse-cutover-existing-db.mjs
import { readFileSync, mkdtempSync, cpSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

export const PRODUCTION_ENDPOINT = 'ep-flat-scene-a58qzr72';

export function validateRehearsalUrl(raw) {
  assert(raw, 'REHEARSAL_DATABASE_URL is required');
  const url = new URL(raw);
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL only');
  assert(!url.hostname.toLowerCase().includes(PRODUCTION_ENDPOINT), 'Refusing the production endpoint: use an isolated Neon branch');
  return url.toString();
}

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaRoot = path.resolve(backend, '../prisma');
const candidate = path.join(prismaRoot, 'migration-candidate/migrations');
const FIX = path.join(prismaRoot, 'production-fixes/20261107_restore_review_guards.sql');

async function main() {
  const databaseUrl = validateRehearsalUrl(process.env.REHEARSAL_DATABASE_URL);
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const prisma = (...args) => {
    const r = spawnSync(process.execPath, [path.join(backend, 'node_modules/prisma/build/index.js'), ...args], { cwd: backend, env, encoding: 'utf8' });
    if (r.status !== 0) { process.stderr.write(r.stdout + r.stderr); throw new Error(`prisma ${args.slice(0, 2).join(' ')} failed`); }
    return r.stdout + r.stderr;
  };
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const one = async (sql) => Object.values((await db.$queryRawUnsafe(sql))[0])[0];
  const step = (msg) => console.log(`✔ ${msg}`);
  const stage = mkdtempSync(path.join(tmpdir(), 'medbook-cutover-'));
  try {
    assert.equal(await one(`SELECT to_regclass('public._prisma_migrations') IS NULL`), true, 'Ledger already exists: this database was already adopted');
    const tables = Number(await one(`SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`));
    assert(tables >= 40, `Unexpected schema (${tables} tables)`);
    console.log(`PostgreSQL ${await one('SHOW server_version')} — ${tables} tables`);

    const contentHash = async () => String(await one(`SELECT md5(string_agg(table_name || '=' || (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), '''')) as h from public.%I t', table_name), false, true, '')))[1]::text, ',' order by table_name)) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations'`));
    const before = await contentHash();
    const violations = Number(await one(`SELECT count(*)::int FROM public.reviews WHERE rating NOT BETWEEN 1 AND 5 OR (comment IS NOT NULL AND char_length(comment) > 1000)`));
    assert.equal(violations, 0, 'Existing reviews violate the guards');
    step(`content fingerprint before: ${before.slice(0, 12)}…, review violations: 0`);

    // 1) سكربت الإنتاج مرتين
    prisma('db', 'execute', '--file', FIX, '--url', databaseUrl);
    prisma('db', 'execute', '--file', FIX, '--url', databaseUrl);
    const guardCount = Number(await one(`SELECT count(*)::int FROM pg_constraint WHERE conrelid='public.reviews'::regclass AND contype='c' AND conname IN ('reviews_rating_range','reviews_comment_length') AND convalidated`));
    const trig = Number(await one(`SELECT count(*)::int FROM pg_trigger WHERE tgrelid='public.reviews'::regclass AND tgname='reviews_immutable' AND tgenabled <> 'D'`));
    assert.equal(guardCount, 2); assert.equal(trig, 1);
    for (const [label, sql] of [
      ['update rejected', `UPDATE public.reviews SET rating = rating WHERE id = (SELECT id FROM public.reviews LIMIT 1)`],
      ['rating 9 rejected', `INSERT INTO public.reviews(id,"appointmentId","doctorId","patientId",rating) SELECT 'rehearsal-x', a.id, a."doctorId", r."patientId", 9 FROM public.appointments a CROSS JOIN (SELECT "patientId" FROM public.reviews LIMIT 1) r WHERE NOT EXISTS (SELECT 1 FROM public.reviews x WHERE x."appointmentId" = a.id) LIMIT 1`],
    ]) {
      const hasReviews = Number(await one('SELECT count(*)::int FROM public.reviews')) > 0;
      if (!hasReviews) continue;
      let rejected = false;
      try {
        await db.$transaction(async (tx) => { await tx.$executeRawUnsafe(sql); throw new Error('ROLLBACK_SENTINEL'); });
      } catch (e) {
        // يجب أن يكون الرفض من الحاجز نفسه (check_violation = 23514)، لا من مفتاح فريد أو سبب آخر.
        const code = e?.meta?.code ?? e?.code ?? '';
        rejected = !String(e?.message).includes('ROLLBACK_SENTINEL') && (code === '23514' || /23514|check_violation|violates check constraint|reviews are immutable/i.test(String(e?.message)));
      }
      assert(rejected, label);
      step(label);
    }
    assert.equal(await contentHash(), before, 'Fix script changed data');
    step('review guards applied twice, data unchanged');

    // 2) تبنّي السجل ثم deploy مرتين
    copyFileSync(path.join(prismaRoot, 'schema.prisma'), path.join(stage, 'schema.prisma'));
    cpSync(candidate, path.join(stage, 'migrations'), { recursive: true });
    const schema = path.join(stage, 'schema.prisma');
    prisma('migrate', 'resolve', '--applied', '00000000000000_baseline', '--schema', schema);
    prisma('migrate', 'resolve', '--applied', '00000000000001_guards', '--schema', schema);
    const ledger = async () => JSON.stringify(await db.$queryRawUnsafe(`SELECT migration_name, checksum, finished_at IS NOT NULL AS done, rolled_back_at IS NULL AS ok, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name`));
    const afterResolve = await ledger();
    assert.equal(JSON.parse(afterResolve).length, 2);
    for (const n of [1, 2]) {
      assert.match(prisma('migrate', 'deploy', '--schema', schema), /No pending migrations to apply/);
      assert.equal(await ledger(), afterResolve, `deploy #${n} changed the ledger`);
      step(`migrate deploy #${n}: no pending migrations, ledger unchanged`);
    }
    prisma('migrate', 'status', '--schema', schema);
    prisma('migrate', 'diff', '--from-url', databaseUrl, '--to-schema-datamodel', path.join(prismaRoot, 'schema.prisma'), '--exit-code');
    step('migrate diff: no difference with schema.prisma');

    // 3) الحواجز = ملف guards في المرشح، والبيانات لم تتغير
    const guards = readFileSync(path.join(candidate, '00000000000001_guards/migration.sql'), 'utf8');
    const expectedChecks = [...guards.matchAll(/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"\s+CHECK/g)].map((m) => `${m[1]}.${m[2]}`).sort();
    const actualChecks = (await db.$queryRawUnsafe(`SELECT t.relname||'.'||c.conname AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relnamespace='public'::regnamespace AND c.contype='c' AND c.convalidated ORDER BY 1`)).map((r) => r.n);
    assert.deepEqual(actualChecks, expectedChecks);
    const triggers = Number(await one(`SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`));
    assert.equal(triggers, [...guards.matchAll(/CREATE TRIGGER/g)].length);
    assert.equal(await contentHash(), before, 'Cutover changed data');
    step(`checks ${actualChecks.length}/${expectedChecks.length}, triggers ${triggers}, content fingerprint unchanged`);
    console.log('Cutover rehearsal passed: fix x2, resolve, deploy x2 (no pending), diff clean, guards complete, data unchanged.');
    if (process.env.REHEARSAL_SUMMARY_FILE) writeFileSync(process.env.REHEARSAL_SUMMARY_FILE, JSON.stringify({ tables, checks: actualChecks.length, triggers, fingerprint: before }));
  } finally {
    await db.$disconnect();
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
}
