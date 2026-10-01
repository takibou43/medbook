#!/usr/bin/env bash
# تجهيز قاعدة اختبار PostgreSQL نظيفة لاختبارات التكامل في CI (أو محليًا).
# - يرفض أي عنوان غير محلي حتى لا يلمس Neon أو أي قاعدة إنتاج بالخطأ.
# - ينشئ المخطط بـ prisma db push (نفس طريقة الإنتاج) ثم يطبّق حراسات SQL التي لا يديرها Prisma
#   (triggers وقيود CHECK) من ملفات migrations المكتوبة لتكون قابلة لإعادة التطبيق.
set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL غير مضبوط}"

host="$(node -e 'const u=new URL(process.env.TEST_DATABASE_URL);process.stdout.write(u.hostname)')"
db_name="$(node -e 'const u=new URL(process.env.TEST_DATABASE_URL);process.stdout.write(u.pathname.slice(1))')"
if [[ "$db_name" != "medbook_security_test" ]]; then
  echo "رفض: هذا السكربت مخصص لقاعدة medbook_security_test المعزولة فقط." >&2
  exit 1
fi

case "$host" in
  localhost|127.0.0.1|::1|"[::1]") ;;
  *) echo "رفض: TEST_DATABASE_URL يشير إلى مضيف غير محلي ($host)." >&2; exit 1 ;;
esac

if [ "${DATABASE_URL:-$TEST_DATABASE_URL}" != "$TEST_DATABASE_URL" ]; then
  echo "رفض: DATABASE_URL يختلف عن TEST_DATABASE_URL داخل بيئة الاختبار." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push --schema ../prisma/schema.prisma --skip-generate --accept-data-loss

# psql لا يقبل معاملات Prisma مثل ?schema=public، لذلك نزيل الـquery string.
PSQL_URL="${TEST_DATABASE_URL%%\?*}"

GUARDS=(
  ../prisma/migrations/20260923140000_release_cancelled_slots/migration.sql
  ../prisma/migrations/20260924170000_add_review_guards/migration.sql
  ../prisma/migrations/20260930120000_family_treatment_referrals_stats/migration.sql
  ../prisma/migrations/20261001193000_clinic_referral_discount/migration.sql
)
for f in "${GUARDS[@]}"; do
  echo "تطبيق حراسات SQL: $f"
  psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "قاعدة الاختبار جاهزة."
