import { Router } from "express";
import * as controller from "./auth.controller";
import { validate } from "../../middleware/validate";
import {
  registerPatientSchema,
  registerDoctorSchema,
  registerAssistantSchema,
  loginSchema,
  updateAccountSchema,
} from "./auth.schema";
import { authenticate } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";

const router = Router();

router.post("/register/patient", authLimiter, validate({ body: registerPatientSchema }), controller.registerPatient);
router.post("/register/doctor", authLimiter, validate({ body: registerDoctorSchema }), controller.registerDoctor);
// تسجيل مساعد — لا يُقبل إلا برمز دعوة صالح (token)؛ لا اختيار دور من الواجهة، ونفس حدّ
// المحاولات الصارم المطبَّق على بقية عمليات التسجيل/الدخول لمنع تخمين الرموز بالقوة الغاشمة.
router.post("/register/assistant", authLimiter, validate({ body: registerAssistantSchema }), controller.registerAssistant);
router.post("/login", authLimiter, validate({ body: loginSchema }), controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);
router.get("/me", authenticate, controller.me);
// تغيير البريد و/أو كلمة المرور للحساب الحالي — محمي بكلمة المرور الحالية + حدّ محاولات صارم.
router.patch("/account", authenticate, authLimiter, validate({ body: updateAccountSchema }), controller.updateAccount);

export default router;
