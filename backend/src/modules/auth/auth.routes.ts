import { Router } from "express";
import * as controller from "./auth.controller";
import { validate } from "../../middleware/validate";
import {
  registerPatientSchema,
  registerDoctorSchema,
  registerAssistantSchema,
  loginSchema,
  updateAccountSchema,
  addPatientProfileSchema,
  applyDoctorProfileSchema,
} from "./auth.schema";
import { authenticate, authorize } from "../../middleware/auth";
import { Role } from "@prisma/client";
import { authLimiter } from "../../middleware/rateLimiter";
import { registerClinicSchema, acceptClinicInviteSchema } from "../clinics/clinics.schema";

const router = Router();
router.post("/register/clinic", authLimiter, validate({ body: registerClinicSchema }), controller.registerClinic);
router.post("/register/clinic-doctor", authLimiter, validate({ body: acceptClinicInviteSchema }), controller.registerClinicDoctor);

router.post("/register/patient", authLimiter, validate({ body: registerPatientSchema }), controller.registerPatient);
router.post("/register/doctor", authLimiter, validate({ body: registerDoctorSchema }), controller.registerDoctor);
// تسجيل مساعد — لا يُقبل إلا برمز دعوة صالح (token)؛ لا اختيار دور من الواجهة، ونفس حدّ
// المحاولات الصارم المطبَّق على بقية عمليات التسجيل/الدخول لمنع تخمين الرموز بالقوة الغاشمة.
router.post("/register/assistant", authLimiter, validate({ body: registerAssistantSchema }), controller.registerAssistant);
router.post("/login", authLimiter, validate({ body: loginSchema }), controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);
router.get("/me", authenticate, controller.me);
// حساب بملفين (مريض + طبيب): ملخص الملفين، تفعيل ملف مريض لطبيب، طلب طبيب من مريض، والانتقال إلى واجهة المرضى.
// كلها مقيّدة بسياق الجلسة في الخادم (لا اعتماد على الواجهة)، وتتطلب كلمة المرور من جديد عند إضافة ملف.
router.get("/profiles", authenticate, controller.profiles);
router.post("/profile/patient", authenticate, authorize(Role.DOCTOR), authLimiter, validate({ body: addPatientProfileSchema }), controller.addPatientProfile);
router.post("/profile/doctor", authenticate, authorize(Role.PATIENT), authLimiter, validate({ body: applyDoctorProfileSchema }), controller.applyDoctorProfile);
router.post("/switch/patient", authenticate, authorize(Role.DOCTOR), authLimiter, controller.switchToPatient);
// تغيير البريد و/أو كلمة المرور للحساب الحالي — محمي بكلمة المرور الحالية + حدّ محاولات صارم.
router.patch("/account", authenticate, authLimiter, validate({ body: updateAccountSchema }), controller.updateAccount);

export default router;
