# هيكلة MedBook المعمارية

## نظرة عامة

```
[Browser] → React SPA (RTL) → REST API (Express) → Prisma ORM → PostgreSQL
```

## القرارات المعمارية الرئيسية

1. **Monorepo بسيط بدون أدوات workspace معقدة** — `frontend/` و`backend/` مشروعان مستقلان (كل منهما `package.json` خاص)، يشتركان في `prisma/` واحد في الجذر لتفادي ازدواجية المخطط.

2. **JWT بدل Session** — Access Token قصير الأمد (15 دقيقة) محفوظ في الذاكرة/`localStorage` بجانب الواجهة، وRefresh Token في httpOnly cookie مع Rotation (كل استخدام يُبطل التوكن القديم وينشئ جديدًا) — يوازن بين الأمان وسهولة التوسع الأفقي للـ backend (لا حاجة لمخزن جلسات مركزي).

3. **منع الحجز المزدوج على 3 مستويات دفاعية** (`backend/src/lib/slots.ts` + `appointments.service.ts`):
   - منطقي: توليد الفترات المتاحة من جدول عمل الطبيب مطروحًا منها المواعيد المحجوزة.
   - استعلام مسبق: التحقق أن الفترة المطلوبة ضمن القائمة المتاحة قبل الإنشاء.
   - قيد قاعدة بيانات: `@@unique([doctorId, date, startTime])` في `schema.prisma` كخط دفاع أخير ضد Race Conditions بين طلبين متزامنين.

4. **البنية النمطية (Modules)** — كل ميزة (auth, doctors, appointments, admin...) في `backend/src/modules/<name>/` بنمط ثابت: `*.schema.ts` (Zod) → `*.service.ts` (منطق + Prisma) → `*.controller.ts` (اختياري) → `*.routes.ts`. يسهّل هذا اختبار المنطق بمعزل عن HTTP (انظر `tests/slots.test.ts` و`tests/transitions.test.ts`).

5. **الإشعارات كـ Adapter بسيط** — `createNotification()` في `notifications.service.ts` هي نقطة الدخول الوحيدة المستخدمة من بقية النظام. لإضافة قناة خارجية (Email/SMS/WhatsApp) لاحقًا، يكفي تعديل هذه الدالة لتستدعي مزودًا خارجيًا إضافة إلى الحفظ في قاعدة البيانات — لا حاجة لتعديل أي وحدة أخرى تستدعيها.

6. **RBAC على مستوى Middleware، والتحقق من الملكية على مستوى Service** — `authenticate` + `authorize(...roles)` يحميان المسار، لكن التحقق من "هل هذا الموعد يخص هذا المستخدم تحديدًا" يتم داخل `appointments.service.ts` (`updateStatus`) لأنه يحتاج بيانات من قاعدة البيانات لا تتوفر في الـ middleware.

7. **Prisma schema في الجذر مع output مخصص** — `generator client { output = "../backend/node_modules/.prisma/client" }` بسبب أن `prisma/` خارج `backend/` (كما طُلب في هيكلة المشروع)، فيُوجَّه العميل المُولَّد صراحة إلى `node_modules` الخاص بـ backend حتى يعمل `import { PrismaClient } from "@prisma/client"` بشكل طبيعي.

8. **استثناء «مريض حضر بدون موعد» (Walk-in)** — `POST /api/appointments/walk-in` في `backend/src/modules/appointments/walkIn.service.ts`. هو المسار الوحيد الذي ينشئ فيه غير المريض موعدًا لضيف، وله قواعد ثابتة:
   - **المساعد وحده** (`authorize(Role.ASSISTANT)` + فحص مكرر في الخدمة). الطبيب لا يسجّل من هنا؛ هو يبرمج مرضاه عبر «موعد العودة».
   - **الطبيب يُستخرج من جلسة المساعد** عبر `resolveActingDoctorId` (نفس فحص العيادة والتعطيل في الطابور). الجسم `.strict()` فلا يُقبل `doctorId` ولا `patientId` ولا `familyMemberId`، وترويسة `X-Assistant-Doctor-Id` لطبيب خارج نطاق المساعد ⇒ 403.
   - **ضيف بالاسم ورقم جزائري** (`^0[5-7][0-9]{8}$`): `patientId = null` دائمًا. الاسم أو الهاتف لا يثبتان هوية حساب، فلا بحث عن مريض بالرقم ولا ربط ولا دمج.
   - **اليوم فقط.** `startTime` اختياري (HH:mm من أوقات اليوم المتاحة):
     - محدد ⇒ ذلك الوقت بالضبط عبر `reserveExactSlot`. خارج شبكة أوقات الطبيب أو مضى ⇒ 400، محجوز ⇒ 409 `SLOT_TAKEN` برسالة واضحة. لا يُنقل المريض إلى وقت آخر بصمت.
     - غير محدد ⇒ أقرب فترة حرة لم يمضِ وقتها عبر `reserveRequestedOrNextSlot`. لا وقت شاغر ⇒ 409 `NO_SLOT_TODAY`.
     - كلاهما تحت قفل الطابور والقيد الفريد (القرار 3)، ولا يُنشأ شيء عند الرفض.
   - **الملاحظات:** `notes` = «سُجّل بواسطة المساعد» دائمًا، تتبعها ملاحظات المساعد كما أدخلها (`سُجّل بواسطة المساعد — …`).
   - **`CONFIRMED` مع `arrivedAt = الآن`**، فيدخل طابور اليوم مباشرة.
   - **`idempotencyKey` إلزامي** (القيد الموجود `@@unique([doctorId, idempotencyKey])`)، ويُفحص داخل القفل: النقر المزدوج والطلبات المتزامنة تعيد نفس الموعد. المفتاح نفسه لطلب مختلف (اسم أو هاتف أو ملاحظات أو وقت محدد مختلف) أو من مساعد آخر ⇒ 409.
   - **لا إشعار ولا Push ولا SMS ولا تذكير** لأي طرف. سطر AuditLog `WALK_IN_APPOINTMENT_CREATED` بلا اسم ولا هاتف.
   - `createdBy = GUEST` و`createdByUserId` = حساب المساعد (لا قيمة ASSISTANT في enum؛ إضافتها تتطلب migration). الاستجابة بلا أي بيانات مالية.
   - لا تغيير في المخطط ولا migrations.

## نقاط توسّع مستقبلية جاهزة في المخطط

- `ai_conversations` / `ai_messages` — جاهزتان لطبقة MedBook AI (مؤجلة، راجع `TODO.md`).
- `doctor_documents` — جاهز لرفع شهادات الطبيب (يحتاج تكامل تخزين ملفات).
- `favorites` — منجز بالكامل (API + جدول).
- `audit_logs` — يُسجَّل تلقائيًا لكل إجراء إداري حسّاس (توثيق طبيب، حذف مستخدم...).
