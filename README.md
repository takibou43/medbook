# MedBook — مادبوك 🩺

منصة رقمية لحجز وإدارة المواعيد الطبية، موجهة للسوق الجزائري، بواجهة عربية RTL كاملة.

Frontend: React + TypeScript + Vite + Tailwind CSS + TanStack Query + React Hook Form
Backend: Node.js + TypeScript + Express + Prisma ORM
Database: PostgreSQL
Auth: JWT (Access + Refresh) + Role-Based Access Control (PATIENT / DOCTOR / ADMIN)

فحوص المشروع موجودة في `.github/workflows/ci.yml`: بناء الأجزاء الثلاثة واختبارات الواجهتين والخادم، بما فيها اختبارات PostgreSQL في بيئة CI معزولة. نجاح الفحوص المحلية لا يؤكد حالة النسخة المنشورة؛ يجب التحقق من الحجز والصلاحيات على بيئة التشغيل قبل استقبال أطباء حقيقيين.

---

## 1. المتطلبات

- Node.js 22.12 أو أحدث ضمن الإصدار 22 (وفق `backend/package.json`)
- npm 10+
- PostgreSQL 16 (أو Docker)

---

## 2. التشغيل السريع (Docker — الطريقة الموصى بها)

```bash
cd medbook
cp .env.example .env
# عدّل JWT_SECRET و JWT_REFRESH_SECRET داخل .env بقيم عشوائية طويلة

docker compose up --build
```

بعد اكتمال التشغيل:
- Backend: http://localhost:4000
- Frontend: http://localhost:5173
- PostgreSQL: localhost:5432

الحاوية الخلفية (backend) تُشغّل تلقائيًا: `prisma migrate deploy` ثم `db:seed` ثم تبدأ الخادم — لذلك ستجد بيانات تجريبية جاهزة عند أول تشغيل.

---

## 3. التشغيل المحلي بدون Docker

### 3.1 قاعدة البيانات

ثبّت PostgreSQL محليًا وأنشئ قاعدة بيانات:

```sql
CREATE DATABASE medbook;
CREATE USER medbook WITH PASSWORD 'medbook';
GRANT ALL PRIVILEGES ON DATABASE medbook TO medbook;
```

### 3.2 Backend

```bash
cd backend
cp ../.env.example ../.env   # إن لم يكن موجودًا مسبقًا
npm install
npm run prisma:generate
npm run prisma:migrate       # ينشئ الجداول (سيطلب اسم migration، اكتب مثلاً init)
npm run db:seed              # يعبّئ بيانات تجريبية جزائرية واقعية
npm run dev                  # يشغّل الخادم على http://localhost:4000
```

### 3.3 Frontend

```bash
cd frontend
npm install
npm run dev                  # يشغّل الواجهة على http://localhost:5173
```

---

## 4. حسابات تجريبية (بعد تشغيل `db:seed`)

| الدور | البريد الإلكتروني | كلمة المرور |
|---|---|---|
| إدارة | admin@medbook.dz | Admin@123 |
| طبيب | dr.1@medbook.dz … dr.20@medbook.dz | Doctor@123 |
| مريض | patient.1@medbook.dz … patient.10@medbook.dz | Patient@123 |

---

## 5. هيكلة المشروع

```
medbook/
├── frontend/          # واجهة المرضى: React + Vite + Tailwind (RTL)
│   └── src/
│       ├── components/ui/     # العناصر المشتركة (Button, Input, States...)
│       ├── components/layout/ # Header, Footer, Layout
│       ├── pages/              # الحجز، حالة الموعد، العيادات، account/
│       ├── hooks/               # React Query hooks
│       ├── context/            # AuthContext
│       └── lib/                # axios client, query client
├── frontend-doctor/    # واجهة الطبيب والمساعد والعيادة والإدارة
├── backend/            # Express + TypeScript
│   └── src/
│       ├── modules/            # auth, doctors, appointments, admin, reviews...
│       ├── middleware/         # auth, validate, errorHandler, rateLimiter
│       ├── lib/                 # prisma client, slots.ts (منطق التوفر)
│       └── config/
├── prisma/
│   ├── schema.prisma    # كل الجداول (18 نموذج)
│   └── seed.ts           # بيانات جزائرية واقعية
├── docs/
│   ├── API.md
│   └── ARCHITECTURE.md
├── docker-compose.yml
├── .env.example
└── TODO.md              # كل ما لم يُنفَّذ بعد أو يحتاج تحسينًا — بشفافية كاملة
```

---

## 6. تشغيل الاختبارات

```bash
cd backend
npm test
```

الاختبارات المضمّنة (لا تحتاج قاعدة بيانات — منطق نقي 100%):
- `tests/slots.test.ts` — منع الحجز المزدوج (Double Booking)، رفض الحجز خارج أوقات العمل، رفض الحجز في يوم عطلة.
- `tests/transitions.test.ts` — قواعد انتقال حالة الموعد حسب الدور (مريض/طبيب/إدارة).
- `tests/password.test.ts` — تشفير كلمات المرور.
- `tests/jwt.test.ts` — توليد والتحقق من التوكنات.
- `tests/integration/booking.integration.test.ts` — اختبار تكاملي كامل، **يتطلب `TEST_DATABASE_URL`** (يُتخطّى تلقائيًا بدونه). راجع `TODO.md`.

---

## 7. الأمان

- كلمات المرور مشفّرة بـ bcrypt.
- JWT Access Token قصير الأمد (15 دقيقة) + Refresh Token في httpOnly cookie مع Rotation.
- Helmet لهيدرز HTTP الأمنية، CORS مقيّد بـ CLIENT_URL، Rate Limiting (عام + صارم على auth).
- تحقق شامل من المدخلات عبر Zod على كل route.
- RBAC صارم على مستوى Middleware لكل مسار حساس.
- لا أسرار داخل الكود — كل شيء عبر `.env` (راجع `.env.example`).

---

## 8. النشر (Deployment)

- **Frontend**: يُبنى بـ `npm run build` داخل `frontend/` وينشر على Vercel (اضبط `VITE_API_URL` في إعدادات البيئة).
- **Backend**: يُبنى بـ `npm run build` وينشر على Railway / Render / VPS (اضبط كل متغيرات `.env.example`).
- **Database**: أي مزوّد PostgreSQL مُدار (Railway، Neon، Supabase، RDS...).

راجع `docs/API.md` لكل مسارات الـ API المتاحة.
