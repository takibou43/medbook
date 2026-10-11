#!/usr/bin/env bash
# اختبار هجرة توحيد التصميمين (20261011190000_reconcile_follow_up_designs) على جدول appointments مصغّر في قاعدة معزولة.
# السيناريوهات: حالة الإنتاج المرصودة، إعادة التنفيذ، التراجع، الإيقاف عند حالة غير متوقعة، غياب الأعمدة القديمة، منع التكرار.
# يرفض أي مضيف غير محلي. الاستعمال: ADMIN_URL=postgresql://user:pass@127.0.0.1:5432/postgres bash scripts/test-reconcile-migration.sh
set -euo pipefail
: "${ADMIN_URL:?ADMIN_URL غير مضبوط}"
host="$(node -e 'process.stdout.write(new URL(process.env.ADMIN_URL).hostname)')"
case "$host" in localhost|127.0.0.1|::1|"[::1]") ;; *) echo "رفض: مضيف غير محلي ($host)" >&2; exit 1 ;; esac

here="$(cd "$(dirname "$0")" && pwd)"
M="$here/../../prisma/migrations/20261011190000_reconcile_follow_up_designs"
base="${ADMIN_URL%/*}"
q() { psql "$base/$1" -v ON_ERROR_STOP=1 -qAt -c "$2"; }
f() { psql "$base/$1" -v ON_ERROR_STOP=1 -q -f "$2"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
eq() { [ "$1" = "$2" ] || fail "$3 (المتوقع '$2' والفعلي '$1')"; }

mk() { # mk <db> <with_legacy_cols yes|no> : حالة الإنتاج المرصودة بصفوف اصطناعية
  psql "$ADMIN_URL" -qAt -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" >/dev/null
  q "$1" "CREATE TABLE appointments (id text primary key, \"doctorId\" text not null, date date not null, \"startTime\" text not null, status text not null, \"activeSlot\" boolean default true, \"parentAppointmentId\" text, \"createdBy\" text not null default 'PATIENT', \"type\" text not null default 'NORMAL')"
  if [ "$2" = yes ]; then
    q "$1" "ALTER TABLE appointments ADD COLUMN \"doctorFollowUp\" boolean not null default false, ADD COLUMN \"slotSeq\" integer not null default 0"
    q "$1" "CREATE UNIQUE INDEX \"appointments_doctorId_date_startTime_activeSlot_key\" ON appointments(\"doctorId\",date,\"startTime\",\"slotSeq\",\"activeSlot\")"
    q "$1" "ALTER TABLE appointments ADD CONSTRAINT appointments_slot_seq_follow_up_chk CHECK (\"slotSeq\" >= 0 AND (\"slotSeq\" = 0 OR \"doctorFollowUp\" = true))"
  else
    q "$1" "CREATE UNIQUE INDEX \"appointments_doctorId_date_startTime_activeSlot_key\" ON appointments(\"doctorId\",date,\"startTime\",\"activeSlot\")"
  fi
  q "$1" "INSERT INTO appointments(id,\"doctorId\",date,\"startTime\",status,\"activeSlot\",\"parentAppointmentId\",\"createdBy\",\"type\") VALUES
    ('a1','d1','2026-10-12','09:00','CONFIRMED',true,NULL,'PATIENT','NORMAL'),
    ('a2','d1','2026-10-12','09:15','CONFIRMED',true,'a1','DOCTOR','FOLLOW_UP'),
    ('a3','d1','2026-10-12','09:30','CANCELLED',NULL,NULL,'PATIENT','NORMAL'),
    ('a4','d1','2026-10-12','09:30','LATE',true,NULL,'PATIENT','NORMAL'),
    ('a5','d2','2026-10-12','09:00','COMPLETED',true,'a1','DOCTOR','FOLLOW_UP'),
    ('a6','d2','2026-10-13','10:00','CONFIRMED',true,'a1','PATIENT','NORMAL')"
}
snap() { q "$1" "SELECT md5(string_agg(id||'|'||\"doctorId\"||'|'||date||'|'||\"startTime\"||'|'||status||'|'||coalesce(\"activeSlot\"::text,'n'), ',' ORDER BY id)) FROM appointments"; }
idx() { q "$1" "SELECT indexdef FROM pg_indexes WHERE tablename='appointments' AND indexname='appointments_doctorId_date_startTime_activeSlot_key'"; }

echo "== A: حالة الإنتاج المرصودة"
mk rc_a yes; before="$(snap rc_a)"
f rc_a "$M/migration.sql"
eq "$(snap rc_a)" "$before" "A: تغيّرت المواعيد (الوقت/الحالة/النشاط)"
eq "$(q rc_a "SELECT string_agg(id,',' ORDER BY id) FROM appointments WHERE \"isFollowUp\"")" "a2,a5" "A: علامة العودة للصفوف المطابقة فقط"
case "$(idx rc_a)" in *slotSeq*) fail "A: الفهرس ما زال يشمل slotSeq";; esac
eq "$(q rc_a "SELECT count(*) FROM information_schema.columns WHERE table_name='appointments' AND column_name IN ('doctorFollowUp','slotSeq','isFollowUp','followUpAnchorId')")" "4" "A: لم تُحذف أعمدة"
echo "== A2: إعادة التنفيذ (idempotent)"
f rc_a "$M/migration.sql"; eq "$(snap rc_a)" "$before" "A2: تغيّرت المواعيد"
eq "$(q rc_a "SELECT count(*) FROM appointments WHERE \"isFollowUp\"")" "2" "A2: عدد العلامات"
echo "== D: منع التكرار بعد التوحيد"
if q rc_a "INSERT INTO appointments(id,\"doctorId\",date,\"startTime\",status) VALUES ('dup','d1','2026-10-12','09:00','CONFIRMED')" 2>/dev/null; then fail "D: قُبل حجزان نشطان في الوقت نفسه"; fi
q rc_a "INSERT INTO appointments(id,\"doctorId\",date,\"startTime\",status,\"activeSlot\") VALUES ('ok-cancelled','d1','2026-10-12','09:00','CANCELLED',NULL)"
echo "== R: التراجع ثم إعادة التوحيد"
q rc_a "DELETE FROM appointments WHERE id='ok-cancelled'"
f rc_a "$M.rollback.sql"; eq "$(snap rc_a)" "$before" "R: تغيّرت المواعيد بعد التراجع"
case "$(idx rc_a)" in *slotSeq*) ;; *) fail "R: لم يعد الفهرس الخماسي";; esac
eq "$(q rc_a "SELECT string_agg(id,',' ORDER BY id) FROM appointments WHERE \"doctorFollowUp\"")" "a2,a5" "R: علامة العودة لم تُحفظ"
eq "$(q rc_a "SELECT count(*) FROM information_schema.columns WHERE column_name IN ('isFollowUp','followUpAnchorId') AND table_name='appointments'")" "0" "R: أعمدة #48 لم تُحذف"
f rc_a "$M/migration.sql"; eq "$(snap rc_a)" "$before" "R2: تغيّرت المواعيد بعد إعادة التوحيد"
eq "$(q rc_a "SELECT string_agg(id,',' ORDER BY id) FROM appointments WHERE \"isFollowUp\"")" "a2,a5" "R2: العلامات"

echo "== B: حالة غير متوقعة (slotSeq>0) ⇒ إيقاف دون أي تغيير"
mk rc_b yes
q rc_b "INSERT INTO appointments(id,\"doctorId\",date,\"startTime\",status,\"doctorFollowUp\",\"slotSeq\") VALUES ('shared','d1','2026-10-12','09:00','CONFIRMED',true,1)"
before_b="$(snap rc_b)"; idx_b="$(idx rc_b)"
if f rc_b "$M/migration.sql" 2>/dev/null; then fail "B: كان يجب أن تتوقف الهجرة"; fi
eq "$(snap rc_b)" "$before_b" "B: تغيّرت المواعيد"
eq "$(idx rc_b)" "$idx_b" "B: تغيّر الفهرس"
eq "$(q rc_b "SELECT count(*) FROM information_schema.columns WHERE column_name='isFollowUp' AND table_name='appointments'")" "0" "B: لم تتراجع المعاملة"

echo "== C: قاعدة بلا أعمدة PR #47"
mk rc_c no; before_c="$(snap rc_c)"
f rc_c "$M/migration.sql"; eq "$(snap rc_c)" "$before_c" "C: تغيّرت المواعيد"
eq "$(q rc_c "SELECT string_agg(id,',' ORDER BY id) FROM appointments WHERE \"isFollowUp\"")" "a2,a5" "C: العلامات"
case "$(idx rc_c)" in *slotSeq*) fail "C: الفهرس يشمل slotSeq";; esac

for d in rc_a rc_b rc_c; do psql "$ADMIN_URL" -qAt -c "DROP DATABASE IF EXISTS $d" >/dev/null; done
echo "OK: كل سيناريوهات الهجرة نجحت."
