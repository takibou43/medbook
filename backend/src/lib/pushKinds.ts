/**
 * أنواع Push الخاصة التي يعاملها الـService Worker لموقع المرضى (frontend/public/sw.js) بسلوك مختلف.
 * ملف مستقل بلا أي اعتماديات حتى يُستورد من أي مكان (ومن الاختبارات) دون تحميل web-push أو Prisma.
 * يجب أن تطابق القيم MB_ALARM_KIND و MB_QUEUE_APPROACH_KIND في sw.js.
 */
export const FIVE_MINUTE_ALARM_KIND = "APPOINTMENT_5MIN_ALARM" as const;
// «دورك اقترب»: نفس نمط المنبّه (نفس الرنة والاهتزاز)، بسجل منع تكرار منفصل عن تنبيه الـ5 دقائق.
export const QUEUE_APPROACH_ALARM_KIND = "QUEUE_APPROACH_ALARM" as const;

export type AlarmPushKind = typeof FIVE_MINUTE_ALARM_KIND | typeof QUEUE_APPROACH_ALARM_KIND;
