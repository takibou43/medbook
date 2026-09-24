-- تنبيه «دورك اقترب» (نوع تذكير ثالث في نفس جدول appointment_reminders، بنفس القيد الفريد لمنع التكرار).
ALTER TYPE "ReminderType" ADD VALUE IF NOT EXISTS 'QUEUE_APPROACH';
