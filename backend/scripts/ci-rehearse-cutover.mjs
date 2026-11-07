// بروفة الانتقال من `prisma db push` إلى `prisma migrate deploy` على قاعدة محلية معزولة بشكل الإنتاج.
// لا تلمس Neon ولا أي قاعدة غير localhost/medbook_cutover_test، ولا تغيّر ملفات الترحيل أو أمر الإقلاع.
//
// شكل الإنتاج (فحص كتالوج Neon 2026-11-07): مخطط المرشح نفسه، لكن
//   - تعدادا Role وAppointmentStatus بترتيب الإنتاج (قيم أُلحقت لاحقًا)،
//   - بلا حاجزي التقييمات ولا مشغل reviews_immutable،
//   - بلا جدول _prisma_migrations.
// الخطوات: بناء الشكل + بيانات اصطناعية → تطبيق سكربت الإنتاج مرتين → migrate resolve للملفين
// → migrate deploy مرتين → migrate diff بلا فرق → مقارنة الحواجز ببصمات المحتوى قبل/بعد.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaRoot = path.resolve(backend, '../prisma');
const candidate = path.join(prismaRoot, 'migration-candidate/migrations');

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
  SELECT 'a'||g,'p1','d1',date '2026-11-01' + g,'09:00','09:07','COMPLETED',now() FROM generate_series(1,6) g;
INSERT INTO reviews(id,"appointmentId","doctorId","patientId",rating,comment) SELECT 'r'||g,'a'||g,'d1','p1',1+(g%5),'ok' FROM generate_series(1,5) g;
INSERT INTO refresh_tokens(id,"userId","tokenHash","expiresAt") VALUES ('t1','up','h1',now()+interval '7 days');
`);

// 2) نفس سكربت البروفة الذي يُشغَّل على فرع Neon معزول (rehearse-cutover-existing-db.mjs)
const r = spawnSync(process.execPath, [path.join(backend, 'scripts/rehearse-cutover-existing-db.mjs')], {
  cwd: backend, env: { ...process.env, REHEARSAL_DATABASE_URL: databaseUrl }, stdio: 'inherit',
});
assert.equal(r.status, 0, 'rehearsal on the production-shaped database failed');
