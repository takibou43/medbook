import { Prisma } from "@prisma/client";

/**
 * قفل استشاري (advisory lock) على مستوى المعاملة لطابور طبيب واحد.
 *
 * يُستدعى أول شيء داخل prisma.$transaction: كل طلب حجز تلقائي لنفس الطبيب ينتظر دوره هنا،
 * فيقرأ "أول دور شاغر" ويكتبه دون أن يسبقه طلب آخر بين القراءة والكتابة. أطباء مختلفون لا
 * يتعطّلون بعضهم ببعض (مفتاح القفل خاص بكل طبيب). يُحرَّر القفل تلقائيًا عند commit/rollback،
 * ولا يعتمد على أي جدول أو عمود جديد، ويعمل مع اتصالات Neon/pgbouncer لأنه داخل معاملة واحدة.
 * قيد التفرّد @@unique([doctorId, date, startTime]) يبقى خط الدفاع الأخير.
 */
export async function lockDoctorQueue(tx: Prisma.TransactionClient, doctorId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"doctor-queue:" + doctorId}, 0))`;
}
