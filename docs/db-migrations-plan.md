# قواعد تغيير قاعدة البيانات وخطة استبدال `prisma db push`

## لماذا حدث التعارض (2026-10-11)
جلستان عملتا على الميزة نفسها: الأولى (PR #47) طبّقت SQL على Neon قبل الدمج، والثانية (PR #48) دُمجت في `main` بمخطط لا يعرف أعمدة الأولى.
عند إقلاع Render نفّذ `prisma db push` فوجد أعمدة/فهرسًا غير موجودة في المخطط، فطلب `--accept-data-loss` وفشل النشر (`update_failed`).
الإنتاج بقي يعمل بالنسخة السابقة لأن Render لا يستبدلها عند فشل الإقلاع.

## قواعد تمنع التكرار (تسري على كل الجلسات)
1. **المخطط أولًا:** لا يُطبَّق أي SQL على الإنتاج قبل أن يكون `prisma/schema.prisma` في `main` (أو في PR جاهز للدمج مباشرة بعده) يصف الشكل الجديد كاملًا.
2. **توسّع ثم انكماش:** التغيير الأول إضافي فقط (أعمدة بقيم افتراضية، فهارس جديدة). الحذف/إعادة التسمية في تغيير لاحق منفصل وبموافقة ونسخة احتياطية.
3. **ملف ترحيل واحد لكل تغيير مخطط** في `prisma/migrations/<timestamp>_<name>/migration.sql` — idempotent، مع `rollbacks/` و`verify/`، ومُضاف إلى GUARDS في `backend/scripts/ci-prepare-test-db.sh` إن كان خارج ما يديره Prisma (CHECK، triggers).
4. **نسخة احتياطية قبل أي تغيير إنتاجي:** فرع Neon باسم `backup-before-<feature>-<date>` (بلا compute) + `verify-<feature>-<date>` لتجربة الترحيل على بيانات حقيقية.
5. **قبل فتح PR يمس المخطط:** `git fetch origin main` ودمجه في الفرع؛ وأي جلسة تجد PR مفتوحًا لنفس الميزة تتوقف وتسأل بدل أن تبني نسخة موازية.
6. **لا `--accept-data-loss` في الإنتاج أبدًا.**

## خطة استبدال `prisma db push` بـ `prisma migrate deploy` (للتنفيذ لاحقًا بموافقة)
حاليًا `start = prisma db push && node dist/index.js`. المشكلة: يعدّل الإنتاج ضمنيًا عند كل إقلاع ويفاجئنا بتحذيرات فقدان البيانات.
1. توليد ترحيل أساسي من الحالة الفعلية: `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/00000000000000_baseline/migration.sql`.
2. تحقق من أن الأساس مطابق للإنتاج: `prisma migrate diff --from-url "$PROD_URL" --to-schema-datamodel prisma/schema.prisma` يجب أن يكون فارغًا (يُنفَّذ على فرع Neon النسخة لا على الإنتاج).
3. على الإنتاج مرة واحدة: `prisma migrate resolve --applied 00000000000000_baseline` (يكتب جدول `_prisma_migrations` فقط).
4. تحويل ملفات SQL اليدوية الحالية إلى ترحيلات Prisma مرتبة بعد الأساس (كلها idempotent، فتطبيقها على الإنتاج آمن).
5. تغيير أمر التشغيل في Render إلى `npx prisma migrate deploy --schema ../prisma/schema.prisma && node dist/index.js`.
6. في CI: خطوة `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url $SHADOW --exit-code` تفشل إن تغيّر المخطط بلا ترحيل — هذا هو الحارس الدائم ضد تعارض الجلسات.
7. التراجع عن الخطوة 5 فوري (إعادة أمر التشغيل القديم) ولا يمس البيانات.
