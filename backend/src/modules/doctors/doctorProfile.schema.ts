import { z } from "zod";
import { specialtyNameSchema } from "../../lib/specialtySelection";

export const profileSchema = z.object({
  bio: z.string().max(4000).optional(),
  yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
  languages: z.array(z.string().max(40)).max(10).optional(),
  consultationFee: z.coerce.number().int().min(0).optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
  // https فقط: الصورة تُعرض لكل المرضى، ورابط http يكشف عناوينهم لخادم خارجي بلا تشفير.
  photoUrl: z.string().url().max(1000).startsWith("https://", "رابط الصورة يجب أن يبدأ بـ https://").optional(),
  clinicId: z.string().uuid().optional(),
  specialtyId: z.string().uuid().optional(),
  specialtyName: specialtyNameSchema.optional(),
  wilayaId: z.string().uuid().optional(),
  cityId: z.string().uuid().optional(),
  // مدة الجلسة بالدقائق — يبني عليها النظام ترتيب أدوار المرضى.
  slotDurationMin: z.coerce.number().int().min(5).max(120).optional(),
  // إحداثيات موقع العيادة — يضبطها الطبيب بنفسه (زر "استخدم موقعي الحالي" في المتصفح)
  // حتى يستطيع المرضى رؤية المسافة وفتح الملاحة. اختيارية تمامًا، بلا أي خدمة جيوكودينغ.
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});
