import { z } from "zod";
import { specialtyNameSchema } from "../../lib/specialtySelection";

export const profileSchema = z.object({
  bio: z.string().optional(),
  yearsExperience: z.coerce.number().int().min(0).optional(),
  languages: z.array(z.string()).optional(),
  consultationFee: z.coerce.number().int().min(0).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  photoUrl: z.string().url().optional(),
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
