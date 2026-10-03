import { Router, Request, Response } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { authLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { PATIENT_REFRESH_COOKIE, setPatientSession, setDoctorSession, clearPatientSession, clearDoctorSession } from "../../lib/sessionCookies";
import { issueDoctorPortalSession } from "../auth/profiles.service";
import { patientRegisterSchema, patientLoginSchema, pushSubscriptionSchema, unsubscribeSchema } from "./patientAuth.schema";
import * as service from "./patientAuth.service";

/**
 * حساب المريض:
 *   /api/patient/auth           تسجيل، دخول، تجديد، خروج، الحساب الحالي
 *   /api/patient/account        مواعيدي
 *   /api/patient/notifications  اشتراك/إلغاء اشتراك Push + إشعار تجريبي
 *
 * تُسجَّل في app.ts قبل "/api/patient" العام، لأن ذلك الراوتر يفرض مصادقة المريض على كل ما تحته
 * (فكان سيرفض تسجيل الدخول نفسه بـ401).
 *
 * كوكي التجديد خاص بالمريض (اسم ومسار منفصلان عن كوكي الأطباء /api/auth)، فلا تداخل بين الجلستين
 * ولا تغيير في مصادقة الأطباء والمساعدين. الطبيب الذي فعّل ملف مريض يدخل من هنا بجلسة بسياق مريض.
 */
export const patientAuthRouter = Router();

patientAuthRouter.post(
  "/register",
  authLimiter,
  validate({ body: patientRegisterSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.registerPatientAccount(req.body);
    setPatientSession(res, result.refreshToken);
    res.status(201).json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  })
);

patientAuthRouter.post(
  "/login",
  authLimiter,
  validate({ body: patientLoginSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.loginPatient(req.body.email, req.body.password);
    setPatientSession(res, result.refreshToken);
    res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  })
);

patientAuthRouter.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.refreshPatientSession(req.cookies?.[PATIENT_REFRESH_COOKIE]);
    setPatientSession(res, result.refreshToken);
    res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  })
);

patientAuthRouter.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const all = req.body?.allSessions === true;
    await service.logoutPatient(req.cookies?.[PATIENT_REFRESH_COOKIE], all);
    clearPatientSession(res);
    if (all) clearDoctorSession(res);
    res.json({ success: true, message: "تم تسجيل الخروج." });
  })
);

// انتقال من واجهة المرضى إلى لوحة الأطباء لحساب يملك ملف طبيب: جلسة أطباء جديدة تُضبط كوكيها من هنا
// (استدعاء مصادَق بـBearer) فلا يمرّ أي رمز في رابط URL. من دون ملف طبيب: 403.
patientAuthRouter.post(
  "/switch/doctor",
  authLimiter,
  authenticate,
  authorize(Role.PATIENT),
  asyncHandler(async (req: Request, res: Response) => {
    const tokens = await issueDoctorPortalSession(req.user!.id);
    setDoctorSession(res, tokens.refreshToken);
    res.json({ success: true, data: { switched: true } });
  })
);

patientAuthRouter.get(
  "/me",
  authenticate,
  authorize(Role.PATIENT),
  asyncHandler(async (req: Request, res: Response) => {
    const user = await service.getPatientMe(req.user!.id);
    res.json({ success: true, data: user });
  })
);

export const patientAccountRouter = Router();
patientAccountRouter.use(authenticate, authorize(Role.PATIENT));

// ?beneficiary=all|self|<familyMemberId> — فلتر اختياري (الافتراضي: كل مواعيد الأسرة).
// غير strict عمدًا: أي معامل آخر (مثل patientId) يُحذف بصمت ولا يؤثر — صاحب المواعيد من الجلسة وحدها.
const appointmentsQuerySchema = z.object({
  beneficiary: z.union([z.enum(["all", "self"]), z.string().uuid("فرد عائلة غير صالح")]).optional(),
});

patientAccountRouter.get(
  "/appointments",
  validate({ query: appointmentsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.listMyAppointments(req.user!.id, (req.query.beneficiary as string | undefined) ?? "all");
    res.json({ success: true, data });
  })
);

export const patientNotificationsRouter = Router();
patientNotificationsRouter.use(authenticate, authorize(Role.PATIENT));

patientNotificationsRouter.get(
  "/status",
  asyncHandler(async (req: Request, res: Response) => {
    const devices = await service.countMyDevices(req.user!.id);
    res.json({ success: true, data: { devices } });
  })
);

patientNotificationsRouter.post(
  "/subscribe",
  validate({ body: pushSubscriptionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.savePushSubscription(req.user!.id, req.body, req.get("user-agent")?.slice(0, 300) ?? null);
    res.status(201).json({ success: true, data });
  })
);

patientNotificationsRouter.delete(
  "/subscribe",
  validate({ body: unsubscribeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.removePushSubscription(req.user!.id, req.body.endpoint);
    res.json({ success: true, data });
  })
);

// إشعار تجريبي: إلى أجهزة المريض نفسه فقط، ومحدود المعدل — لا يمكن استعماله لإزعاج أحد آخر.
patientNotificationsRouter.post(
  "/test",
  authLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.sendTestPush(req.user!.id);
    res.json({ success: true, data });
  })
);
