/**
 * أنواع Push الخاصة التي يعاملها الـService Worker لموقع المرضى (frontend/public/sw.js) بسلوك مختلف.
 * ملف مستقل بلا أي اعتماديات حتى يُستورد من أي مكان (ومن الاختبارات) دون تحميل web-push أو Prisma.
 * يجب أن تطابق القيمة MB_ALARM_KIND في sw.js.
 */
export const FIVE_MINUTE_ALARM_KIND = "APPOINTMENT_5MIN_ALARM" as const;
