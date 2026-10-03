import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "../utils/ApiError";
import { assistantDoctorContext } from "./assistantDoctorContext";

/**
 * نقطة مركزية واحدة تحل "الطبيب الفعلي" الذي يعمل الحساب الحالي باسمه — سواء كان
 * طبيبًا (حسابه هو نفسه) أو مساعدًا (يختار طبيبًا من عيادته). كل مكان في
 * الكود كان يفترض `doctor.userId === userId` مباشرة يجب أن يمرّ من هنا بدل ذلك.
 *
 * اختيار الطبيب في الترويسة غير موثوق: يُفحص مقابل عيادة المساعد المحفوظة في قاعدة
 * البيانات عند كل طلب. المساعد المستقل يبقى مقيدًا بطبيبه الأصلي.
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
    const selectedId = assistantDoctorContext.getStore();
    if (!assistant.clinicId) {
      if (selectedId && selectedId !== assistant.doctorId) throw ApiError.forbidden();
      return assistant.doctorId;
    }
    const doctor = await prisma.doctor.findFirst({
      where: { id: selectedId ?? assistant.doctorId, clinicId: assistant.clinicId, user: { isActive: true } },
      select: { id: true },
    });
    if (!doctor) throw ApiError.forbidden("هذا الطبيب غير متاح ضمن عيادتك. اختر طبيبًا من القائمة.");
    return doctor.id;
  }

  throw ApiError.forbidden();
}
