#!/usr/bin/env bash
# فحص بنيوي حقيقي بـ Prisma: قاعدة تُحاكي حالة الإنتاج (أعمدة #47 + الفهرس الخماسي + CHECK، بلا أعمدة #48)
# ثم تطبيق هجرة التوحيد، ثم `prisma db push` بدون --accept-data-loss يجب أن ينجح دون أي تغيير
# (أي فرق متبقٍ بين المخطط والقاعدة = سيفشل نشر Render كما حدث مع PR #48).
set -euo pipefail
: "${ADMIN_URL:?ADMIN_URL غير مضبوط}"
host="$(node -e 'process.stdout.write(new URL(process.env.ADMIN_URL).hostname)')"
case "$host" in localhost|127.0.0.1|::1|"[::1]") ;; *) echo "رفض: مضيف غير محلي ($host)" >&2; exit 1 ;; esac
cd "$(dirname "$0")/.."
base="${ADMIN_URL%/*}"; DB=medbook_reconcile_check
URL="$base/$DB?schema=public"; PSQL="$base/$DB"
psql "$ADMIN_URL" -qAt -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null

DATABASE_URL="$URL" npx prisma db push --schema ../prisma/schema.prisma --skip-generate --accept-data-loss >/dev/null
psql "$PSQL" -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER TABLE appointments DROP COLUMN "isFollowUp", DROP COLUMN "followUpAnchorId";
DROP INDEX "appointments_doctorId_date_startTime_activeSlot_key";
CREATE UNIQUE INDEX "appointments_doctorId_date_startTime_activeSlot_key" ON appointments("doctorId", date, "startTime", "slotSeq", "activeSlot");
ALTER TABLE appointments ADD CONSTRAINT appointments_slot_seq_follow_up_chk CHECK ("slotSeq" >= 0 AND ("slotSeq" = 0 OR "doctorFollowUp" = true));
SQL
echo "حالة الإنتاج المحاكاة جاهزة؛ تطبيق الهجرة..."
psql "$PSQL" -v ON_ERROR_STOP=1 -q -f ../prisma/migrations/20261011190000_reconcile_follow_up_designs/migration.sql
echo "prisma db push بدون --accept-data-loss (يجب ألا يطلب أي تغيير)..."
out="$(DATABASE_URL="$URL" npx prisma db push --schema ../prisma/schema.prisma --skip-generate 2>&1)" || { echo "$out" >&2; echo "فشل: ما زال هناك فرق بين المخطط والقاعدة" >&2; exit 1; }
echo "$out" | tail -3
echo "$out" | grep -qi "already in sync" || { echo "$out" >&2; echo "فشل: المتوقع already in sync" >&2; exit 1; }
psql "$ADMIN_URL" -qAt -c "DROP DATABASE IF EXISTS $DB" >/dev/null
echo "OK: المخطط والقاعدة متطابقان بعد الهجرة."
