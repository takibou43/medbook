# قائمة تنظيف الفروع البعيدة (2026-10-26)

تحلّ محل قائمة 2026-10-24 (طلبات الدمج الخمسة التي كانت مفتوحة أُغلقت كلها منذ ذلك الحين).
لم يُحذف أي فرع. الحذف ينتظر موافقة صريحة من Taki.

**الوضع على `main` عند `454e918`:** 126 فرعًا بعيدًا غير main، ولا يوجد أي طلب دمج مفتوح.

**مراجعة الأدلة في 2026-10-30 مقابل main عند `454e918`:**
- 10 فروع ثبت أنها أسلاف لهذه النسخة من main.
- 106 فروع لها طلبات دمج مدموجة تطابق آخر commit في الفرع وقت المراجعة.
- فرع `chore/repo-cleanup-20261024`: طلبه #108 أُغلق دون دمج، لكن محتوى الملفين المعدّلين وحذف الملفين الآخرين يطابق main.
- فرع `fix/complete-timing-2026-10-03`: منطق التوقيت موجود، لكن مطابقة بقية تغييرات الواجهة والاختبارات لم تُحسم؛ نُقل إلى قائمة المراجعة.

لا تُعد عناوين commits المتطابقة دليلًا على تكافؤ المحتوى. قبل أي حذف، تُعاد قراءة SHA الفرع والتحقق من عدم وجود commits جديدة؛
ويُسجّل دليل الاحتواء (سلف لـmain، أو PR مدموج يطابق رأس الفرع، أو مقارنة محتوى التغييرات).
هذه لقطة تاريخية وليست تصريحًا بالحذف، ولا تعني أن كل محتوى قديم ما زال مستخدمًا بعد التطوير اللاحق.

**اقتراح وقائي:** تفعيل «Automatically delete head branches» في إعدادات GitHub
(Settings → General → Pull Requests) حتى لا تتراكم الفروع بعد كل دمج.

## فروع لها دليل احتواء أو دمج — يعاد التحقق قبل حذفها (117)

يمكن استرجاع أي فرع دُمج طلبه من زر Restore branch في صفحة الـPR.

- chore/cleanup-resources-20261005
- chore/repo-cleanup-20261024
- codex/compact-medication-entry
- codex/doctor-dashboard-compact-shift
- codex/doctor-workflow-improvements
- design/patient-doctor-polish
- design/transparent-brand-glass
- diagnose/android-keyboard-picker
- feat/arrival-scanner-ui
- feat/assistant-admission
- feat/clear-assistant-calls
- feat/clinic-ui-polish-20261025
- feat/compact-assistant-queue
- feat/compact-clinics
- feat/compact-doctor-list
- feat/compact-patient-step
- feat/compact-slot-step
- feat/patient-compact-home
- feat/patient-next-slot-cards
- feature/arabic-french-20261010
- feature/assistant-compact-reception-20261004
- feature/assistant-unified-queue-20261004
- feature/attendance-shifts-20261010
- feature/clinic-assistant-assignment-20261004
- feature/clinic-directory-qr-20261017
- feature/clinic-doctor-terms-2026-10-03
- feature/clinic-shared-assistant-20261003
- feature/doctor-dashboard-layout-2026-10-23
- feature/doctor-header-assistant-guard
- feature/doctor-search-icon
- feature/doctor-shift-row-2026-10-23
- feature/doctor-shift-row-modern-2026-10-23
- feature/doctor-ui-complete
- feature/dual-profile-account
- feature/family-treatment-referrals-stats
- feature/follow-up-queue-priority
- feature/glass-sidebar
- feature/glass-sidebar-v2
- feature/gps-nearby-doctors
- feature/patient-account-simplify
- feature/patient-accounts-reminders
- feature/patient-doctor-search
- feature/prescription-a5-presets
- feature/prescription-auto-next-patient-2026-10-23
- feature/prescription-clear-form-2026-10-23
- feature/prescription-designer-20261010
- feature/prescription-dz-style-2026-10-23
- feature/prescription-form-chips-weight-2026-10-23
- feature/prescription-reference-layout
- feature/prescription-simple-editor-20261013
- feature/prescription-structured-ux
- feature/prescription-visual-editor-20261013
- feature/qr-arrival-20261017
- feature/queue-late-penalty
- fix/admin-phase1-20261008
- fix/admin-phase2-20261008
- fix/admin-phase3-20261008
- fix/android-keyboard-focus
- fix/appointment-gps-directions
- fix/assistant-nearest-booking
- fix/attendance-home-assistant-20261007
- fix/awake-eight-hours
- fix/booking-completed-local-prescriptions
- fix/browser-translation-language
- fix/clinic-assistant-management-20261003
- fix/clinic-invites-direct
- fix/clinic-specialty-french-20261010
- fix/compact-language-button-20261010
- fix/compact-live-duty-20261010
- fix/complete-timing-v2
- fix/completed-booking-ranges
- fix/current-patient-plan-modal-20261010
- fix/docker-security-hardening
- fix/doctor-consultation-actions-20261004
- fix/empty-queue-nearest-booking
- fix/idle-background-usage
- fix/medbook-name-20261007
- fix/message-only-attendance-20261007
- fix/only-signed-qr-20261019
- fix/patient-camera-permission-20261017
- fix/patient-notification-dates-20261008
- fix/patient-ux-20261008
- fix/prescription-a5-20261010
- fix/prescription-footer-row
- fix/prescription-long-print-20261015
- fix/prescription-pdf-20261015
- fix/prescription-phase1-20261010
- fix/prescription-preview-language
- fix/prescription-print-flow-20261015
- fix/prescription-reference-balance
- fix/prescription-remove-change-patient
- fix/prescription-upload-and-stationery
- fix/prescription-visual-20261020
- fix/prisma-migration-replay
- fix/qr-arrival-read-20261017
- fix/quiet-staff-bookings-20261005
- fix/render-compression-types-20261005
- fix/resource-polling-and-load-validation
- fix/security-resources-20261024
- fix/shared-live-connection
- fix/sleep-after-18
- fix/unify-follow-up-47-into-48
- improve/booking-prescription-clarity
- local/assistant-reception-ux-20261004
- optimize/free-tier-keepalive-20261011
- optimize/resource-usage
- perf/live-resource-updates-20261005
- release/ci-clinic-referrals-2026-10-01
- release/doctor-attendance-specialties-20261007
- release/prescription-template-20261014
- security/audit-2026-10-21
- security/audit-2026-10-25
- security/audit-fixes-20261019
- security/free-hardening-2026-10-22
- security/hardening-2026-10-20
- security/release-20261003
- ui/clinic-manager-simple-20261017

## فروع تحتاج مراجعة أو قرارًا (9)

| الفرع | آخر commit | الملاحظة |
|---|---|---|
| fix/complete-timing-2026-10-03 | 2026-10-03 | منطق الإصلاح موجود، لكن مطابقة كل تغييرات الواجهة والاختبارات لم تُحسم؛ لا يُحذف اعتمادًا على هذه القائمة |
| audit/isolated-load-20261022 | 2026-10-22 | يضيف ملف workflow واحد (`isolated-load-check.yml`) لاختبار حمل معزول؛ يُدمج إن كان مطلوبًا وإلا يُحذف |
| design/skills-polish | 2026-10-18 | طلب دمجه أُغلق؛ تحسينات تصميم تجاوزتها تحسينات لاحقة |
| feature/live-queue-availability | 2026-09-24 | بلا طلب دمج؛ قديم (8 ملفات) |
| feature/medical-follow-up-priority | 2026-10-11 | أُغلق بلا دمج؛ استُبدل بتوحيد موعد العودة (#48) |
| fix/booking-flood-protection | 2026-10-13 | حماية الإغراق موجودة في main بشكل آخر (`PATIENT_BOOKING_LIMIT` في `patientBooking.ts`) |
| fix/doctor-ui-identity-20261002 | 2026-10-02 | قديم؛ واجهة الطبيب أعيد تصميمها بعده |
| fix/reconcile-follow-up-schema | 2026-10-11 | أُغلق بلا دمج؛ استُبدل بتوحيد #47/#48 |
| security/audit-2026-10-13 | 2026-10-13 | تدقيق قديم؛ تدقيقات 19 و21 و25 أكتوبر أحدث منه |

## تنفيذ الحذف

لا يتضمن هذا الملف أمر حذف جماعي جاهزًا للتنفيذ. يُحضّر نطاق حذف منفصل بعد تحديث الأدلة وتسجيل SHA لكل فرع والحصول على موافقة صريحة. لم يُحذف أي فرع ضمن هذا التغيير.
