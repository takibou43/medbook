import { Router } from "express";
import * as controller from "./auth.controller";
import { validate } from "../../middleware/validate";
import { registerPatientSchema, registerDoctorSchema, loginSchema } from "./auth.schema";
import { authenticate } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";

const router = Router();

router.post("/register/patient", authLimiter, validate({ body: registerPatientSchema }), controller.registerPatient);
router.post("/register/doctor", authLimiter, validate({ body: registerDoctorSchema }), controller.registerDoctor);
router.post("/login", authLimiter, validate({ body: loginSchema }), controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);
router.get("/me", authenticate, controller.me);

export default router;
