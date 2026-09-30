import { z } from "zod";
import { cleanString } from "../../lib/textClean";

/** أقصى عدد أفراد عائلة نشطين (غير مؤرشفين) لكل حساب — حد معقول لمنع الإساءة. */
export const MAX_ACTIVE_FAMILY_MEMBERS = 15;

const relationship = z.enum(["CHILD", "SPOUSE", "PARENT", "SIBLING", "OTHER"], {
  errorMap: () => ({ message: "صلة القرابة غير صالحة" }),
});

// تاريخ الميلاد: YYYY-MM-DD فقط، لا في المستقبل ولا قبل 1900. يُخزَّن كمنتصف ليل UTC لذلك اليوم.
const birthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة تاريخ الميلاد يجب أن تكون YYYY-MM-DD")
  .transform((s, ctx) => {
    const d = new Date(s + "T00:00:00Z");
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "تاريخ ميلاد غير صالح" });
      return z.NEVER;
    }
    if (d.getTime() > Date.now() || d.getUTCFullYear() < 1900) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "تاريخ الميلاد غير منطقي" });
      return z.NEVER;
    }
    return d;
  });

const name = (label: string) => cleanString(2, 60, `${label} قصير جدًا`, `${label} طويل جدًا (60 حرفًا كحد أقصى)`);

// ownerPatientId غير موجود في أي مخطط: يُشتق من الجلسة دائمًا، و .strict() يرفض أي حقل إضافي.
export const createFamilyMemberSchema = z
  .object({
    firstName: name("الاسم"),
    lastName: name("اللقب"),
    relationship,
    birthDate: birthDate.nullable().optional(),
    gender: z.enum(["MALE", "FEMALE"]).nullable().optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const updateFamilyMemberSchema = z
  .object({
    firstName: name("الاسم").optional(),
    lastName: name("اللقب").optional(),
    relationship: relationship.optional(),
    birthDate: birthDate.nullable().optional(),
    gender: z.enum(["MALE", "FEMALE"]).nullable().optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const familyMemberParamsSchema = z.object({ id: z.string().uuid("معرّف غير صالح") });

export const listFamilyQuerySchema = z
  .object({ includeArchived: z.enum(["true", "false"]).optional() })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export type CreateFamilyMemberInput = z.infer<typeof createFamilyMemberSchema>;
export type UpdateFamilyMemberInput = z.infer<typeof updateFamilyMemberSchema>;
