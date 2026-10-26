# TODO / الحدود المعروفة للمشروع

آخر مراجعة: 2026-10-26 على `main` عند `454e918`. هذا الملف يذكر فقط ما لم يُنفَّذ بعد أو ما ينتظر قرارًا؛
النسخة الأولى منه (آب/أغسطس 2026) قديمة واستُبدلت لأن معظم بنودها نُفّذ منذ ذلك الحين
(Web Push، اختبارات التكامل على PostgreSQL في CI، صفحة العيادات العامة...).

## ينتظر قرارًا أو موافقة

1. **تشغيل `prisma db push` عند كل إقلاع** (`backend/package.json` → `start`): الانتقال إلى
   `prisma migrate deploy` قيد التحضير. لا يُغيَّر أمر الإقلاع قبل اجتياز بوابات
   `prisma/migration-candidate/README.md` و`docs/production-migration-preflight-20261026.md`.
2. **جداول غير مستعملة في الكود**: `ai_conversations` و`ai_messages` (طبقة MedBook AI مؤجلة)
   و`doctor_documents` (لا يوجد مسار رفع ملفات). حذفها تغيير على قاعدة الإنتاج ويحتاج موافقة صريحة.
3. **رسائل SMS**: التكامل مع BudgetSMS موجود في الكود لكن الحساب غير مضبوط، فالتذكير بالـSMS غير فعّال.
   تذكير المريض الضيف بالـSMS عند إلغاء موعده غير منفَّذ (`appointments.service.ts`).
4. **رفع الملفات**: لا يوجد endpoint لرفع الصور أو الشهادات؛ `photoUrl` رابط نصي فقط.
5. **حفظ الوصفات الطبية**: مصمَّم ومعطَّل عمدًا (`PRESCRIPTIONS_SAVE_ENABLED`) ما دام المشروع على الخطط المجانية.

## تحسينات تقنية مقترحة (غير عاجلة)

- **zod 3 → zod 4**: ثغرة GHSA-mrhx-c7xc-m3w5 مخفَّفة حاليًا بحدود المدخلات (`inputShape.ts` و`.max()`)،
  والإصلاح الكامل يتطلب الترقية (تغيير كاسر) في فرع مستقل.
- **أدوات التطوير**: vitest 2 وvite 5 عليهما تنبيهات أمنية تخص بيئة التطوير فقط (لا تُشحن للإنتاج).
- **تحميل كسول لصفحات موقع المرضى**: الحزمة الرئيسية ≈ 478KB (153KB مضغوطة) لأن `frontend/src/App.tsx`
  لا يستعمل `lazy()`، بخلاف موقع الطبيب.
- **ملفات مكررة حرفيًا بين الواجهتين** (`i18n/ar.json`، `i18n/fr.json`، `i18n/locale.ts`، `Logo.tsx`،
  `useCatalog.ts`، `nativeKeyboardFocus.ts`، `portalSwitch.ts`، `queryClient.ts`، `specialtyIcons.tsx`):
  نقلها إلى مجلد مشترك واحد.

## اختبارات المتصفح اليدوية (لا تعمل في CI)

- `frontend/tests/arrivalCamera.browser.mjs` — كاميرا وهمية وواجهات API محاكاة لمسح QR الوصول.
- `frontend/tests/patient-ux-fixture.mjs` — خادم محلي ببيانات وهمية (راجع `docs/patient-ux-20261008/REPORT.md`).
- `frontend-doctor/tests/prescriptionLongPrint.browser.mjs` — طباعة الوصفات الطويلة.
- `scripts/verify-language-mobile.cjs` — يتطلب Playwright عبر المتغير `MEDBOOK_PLAYWRIGHT`.
