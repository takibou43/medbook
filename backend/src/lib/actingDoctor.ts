import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "../utils/ApiError";

/**
 * نقطة مركزية واحدة تحل "الطبيب الفعلي" الذي يعمل الحساب الحالي باسمه — سواء كان
 * طبيبًا (حسابه هو نفسه) أو مساعدًا (يعمل نيابة عن طبيب واحد مرتبط به). كل مكان في
 * الكود كان يفترض `doctor.userId === userId` مباشرة يجب أن يمرّ من هنا بدل ذلك.
 *
 * هذا هو خط الدفاع الوحيد ضد IDOR لحسابات المساعدين: لا doctorId يصل أبدًا من جسم
 * الطلب نفسه في أي من مسارات الطبيب/المساعد — يُشتق دائمًا من الجلسة (JWT) فقط.
 *
 * لأي مساعد: يُرفض الوصول فورًا (403) إن كان وصوله معطّلاً (`Assistant.isActive=false`)
 * أو كان حساب الطبيب نفسه معطّلاً (`User.isActive=false`) — تعطيل فوري من الـ Backend،
 * وليس فقط إخفاء عناصر في الواجهة.
 */
export async function resolveActingDoctorId(userId: string, role: Role): Promise<string> {
  if (role === Role.DOCTOR) {
    const doctor = await prisma.doctor.findUnique({ where: { userId } });
    if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
    return doctor.id;
  }

  if (role === Role.ASSISTANT) {
    const assistant = await prisma.assistant.findUnique({
      where: { userId },
      include: { doctor: { include: { user: true } } },
    });
    if (!assistant) throw ApiError.notFound("لم يتم العثور على ملف مساعد مرتبط بهذا الحساب.");
    if (!assistant.isActive) throw ApiError.forbidden("تم تعطيل وصولك من طرف الطبيب. تواصل معه لإعادة التفعيل.");
    if (!assistant.doctor.user.isActive) throw ApiError.forbidden();
    return assistant.doctorId;
  }

  throw ApiError.forbidden();
}
