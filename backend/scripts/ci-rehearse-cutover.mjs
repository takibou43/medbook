// بروفة الانتقال من `prisma db push` إلى `prisma migrate deploy` على قاعدة محلية معزولة بشكل الإنتاج.
// لا تلمس Neon ولا أي قاعدة غير localhost/medbook_cutover_test، ولا تغيّر ملفات الترحيل أو أمر الإقلاع.
//
// شكل الإنتاج (فحص كتالوج Neon 2026-11-07): مخطط المرشح نفسه، لكن
//   - تعدادا Role وAppointmentStatus بترتيب الإنتاج (قيم أُلحقت لاحقًا)،
//   - بلا حاجزي التقييمات ولا مشغل reviews_immutable،
//   - بلا جدول _prisma_migrations.
// الخطوات: بناء الشكل + بيانات اصطناعية → تطبيق سكربت الإنتاج مرتين → migrate resolve للملفين
// → migrate deploy مرتين → migrate diff بلا فرق → مقارنة الحواجز ببصمات المحتوى قبل/بعد.
import { readFileSync, mkdtempSync, cpSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaRoot = path.resolve(backend, '../prisma');
const candidate = path.join(prismaRoot, 'migration-candidate/migrations');
const FIX = path.join(prismaRoot, 'production-fixes/20261107_restore_review_guards.sql');

const url = new URL(process.env.CUTOVER_DATABASE_URL ?? '');
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'local database only');
assert.equal(url.pathname, '/medbook_cutover_test', 'unexpected database');
const databaseUrl = url.toString();
const psqlUrl = databaseUrl.split('?')[0];

function sh(cmd, args, input) {
  const r = spawnSync(cmd, args, { cwd: backend, env: { ...process.env, DATABASE_URL: databaseUrl }, input, encoding: 'utf8' });
  if (r.status !== 0) { process.stderr.write(r.stdout + r.stderr); throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed`); }
  return r.stdout;
}
const psql = (sql) => sh('psql', [psqlUrl, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], sql);
const prisma = (...args) => sh(process.execPath, [path.join(backend, 'node_modules/prisma/build/index.js'), ...args]);

// 1) شكل الإنتاج
assert.equal(psql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'").trim(), '0', 'needs an empty database');
let baseline = readFileSync(path.join(candidate, '00000000000000_baseline/migration.sql'), 'utf8');
baseline = baseline
  .replace(/CREATE TYPE "Role" AS ENUM \([^)]*\);/, `CREATE TYPE "Role" AS ENUM ('PATIENT', 'DOCTOR', 'ADMIN', 'ASSISTANT', 'CLINIC_OWNER');`)
  .replace(/CREATE TYPE "AppointmentStatus" AS ENUM \([^)]*\);/, `CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'IN_PROGRESS', 'LATE', 'RESCHEDULE_REQUIRED');`);
psql(baseline);
const guards = readFileSync(path.join(candidate, '00000000000001_guards/migration.sql'), 'utf8');
const productionGuards = guards
  .replace(/ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range"[^;]*;/, '')
  .replace(/ALTER TABLE "reviews" ADD CONSTRAINT "reviews_comment_length"[^;]*;/, '')
  .replace(/CREATE OR REPLACE FUNCTION reviews_prevent_update\(\)[\s\S]*?LANGUAGE plpgsql;/, '')
  .replace(/CREATE TRIGGER "reviews_immutable"[\s\S]*?;/, '');
assert.notEqual(productionGuards, guards);
psql(productionGuards);
const missing = psql("SELECT count(*) FROM pg_constraint WHERE conrelid='public.reviews'::regclass AND contype='c'").trim();
assert.equal(missing, '0', 'production shape must lack the review CHECKs');

// بيانات اصطناعية فقط (لا بيانات حقيقية)
psql(`
INSERT INTO wilayas(id,code,"nameAr") VALUES ('w1','43','ولاية تجريبية');
INSERT INTO cities(id,"nameAr","wilayaId") VALUES ('c1','بلدية تجريبية','w1');
INSERT INTO specialties(id,"nameAr") VALUES ('s1','تخصص تجريبي');
INSERT INTO users(id,email,"passwordHash",role,"updatedAt") VALUES ('ud','doc@test.invalid','x','DOCTOR',now()),('up','pat@test.invalid','x','PATIENT',now());
INSERT INTO doctors(id,"userId","firstName","lastName","specialtyId","wilayaId","cityId","updatedAt") VALUES ('d1','ud','A','B','s1','w1','c1',now());
INSERT INTO patients(id,"userId","firstName","lastName") VALUES ('p1','up','C','D');
INSERT INTO appointments(id,"patientId","doctorId",date,"startTime","endTime",status,"updatedAt")
  SELECT 'a'||g,'p1','d1',date '2026-11-01' + g,'09:00','09:07','COMPLETED',now() FROM generate_series(1,5) g;
INSERT INTO reviews(id,"appointmentId","doctorId","patientId",rating,comment) SELECT 'r'||g,'a'||g,'d1','p1',1+(g%5),'ok' FROM generate_series(1,5) g;
INSERT INTO refresh_tokens(id,"userId","tokenHash","expiresAt") VALUES ('t1','up','h1',now()+interval '7 days');
`);

const contentHash = () => psql(`SELECT string_agg(table_name || '=' || (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), '''')) as h from public.%I t', table_name), false, true, '')))[1]::text, ',' order by table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations'`).trim();
const before = contentHash();

// 2) سكربت الإنتاج مرتين (آمن للتكرار)
psql(readFileSync(FIX, 'utf8'));
psql(readFileSync(FIX, 'utf8'));
assert.equal(psql("SELECT count(*) FROM pg_constraint WHERE conrelid='public.reviews'::regclass AND contype='c' AND conname IN ('reviews_rating_range','reviews_comment_length') AND convalidated").trim(), '2');
assert.equal(psql("SELECT count(*) FROM pg_trigger WHERE tgrelid='public.reviews'::regclass AND tgname='reviews_immutable'").trim(), '1');
assert.throws(() => psql("UPDATE reviews SET rating=2 WHERE id='r1'"), 'reviews must be immutable');
assert.throws(() => psql("INSERT INTO reviews(id,\"appointmentId\",\"doctorId\",\"patientId\",rating) VALUES ('rx','a1','d1','p1',9)"));
assert.equal(contentHash(), before, 'fix script changed data');

// 3) تبنّي السجل ثم deploy مرتين
const stage = mkdtempSync(path.join(tmpdir(), 'medbook-cutover-'));
try {
  copyFileSync(path.join(prismaRoot, 'schema.prisma'), path.join(stage, 'schema.prisma'));
  cpSync(candidate, path.join(stage, 'migrations'), { recursive: true });
  const schema = path.join(stage, 'schema.prisma');
  prisma('migrate', 'resolve', '--applied', '00000000000000_baseline', '--schema', schema);
  prisma('migrate', 'resolve', '--applied', '00000000000001_guards', '--schema', schema);
  const ledger = () => psql('SELECT migration_name, checksum, finished_at IS NOT NULL, rolled_back_at IS NULL, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name').trim();
  const afterResolve = ledger();
  assert.equal(afterResolve.split('\n').length, 2);
  const out1 = prisma('migrate', 'deploy', '--schema', schema);
  assert.match(out1, /No pending migrations to apply/);
  assert.equal(ledger(), afterResolve, 'first deploy changed the ledger');
  const out2 = prisma('migrate', 'deploy', '--schema', schema);
  assert.match(out2, /No pending migrations to apply/);
  assert.equal(ledger(), afterResolve, 'second deploy changed the ledger');
  prisma('migrate', 'status', '--schema', schema);
  // لا فرق بين القاعدة ونموذج Prisma (Prisma لا يقارن CHECK والمشغلات ولا ترتيب قيم التعداد).
  prisma('migrate', 'diff', '--from-url', databaseUrl, '--to-schema-datamodel', path.join(prismaRoot, 'schema.prisma'), '--exit-code');
} finally {
  rmSync(stage, { recursive: true, force: true });
}

// 4) الحواجز الآن مطابقة لملف guards في المرشح، والبيانات لم تتغير
const checks = [...guards.matchAll(/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"\s+CHECK/g)].map((m) => `${m[1]}.${m[2]}`).sort().join('\n');
assert.equal(psql("SELECT t.relname||'.'||c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relnamespace='public'::regnamespace AND c.contype='c' ORDER BY 1").trim(), checks);
assert.equal(psql("SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal").trim(), String([...guards.matchAll(/CREATE TRIGGER/g)].length));
assert.equal(contentHash(), before, 'cutover changed data');
console.log('Cutover rehearsal passed: fix x2, resolve, deploy x2 (no pending), diff clean, guards complete, data unchanged.');
