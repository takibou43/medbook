import { Router, Request, Response, CookieOptions } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { authLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";
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
 * ولا تغيير في مصادقة الأطباء والمساعدين.
 */
const PATIENT_REFRESH_COOKIE = "medbook_patient_refresh";
const COOKIE_PATH = "/api/patient/auth";
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  // الواجهة (Vercel) والخادم (Render) على نطاقين مختلفين: "none" + secure في الإنتاج، "lax" محليًا.
  sameSite: env.isProd ? "none" : "lax",
  path: COOKIE_PATH,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const patientAuthRouter = Router();

patientAuthRouter.post(
  "/register",
  authLimiter,
  validate({ body: patientRegisterSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.registerPatientAccount(req.body);
    res.cookie(PATIENT_REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.status(201).json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  })
);

patientAuthRouter.post(
  "/login",
  authLimiter,
  validate({ body: patientLoginSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.loginPatient(req.body.email, req.body.password);
    res.cookie(PATIENT_REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  })
);

patientAuthRouter.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.refreshPatientSession(req.cookies?.[PATIENT_REFRESH_COOKIE]);
    res.cookie(PATIENT_REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  })
);

patientAuthRouter.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    await service.logoutPatient(req.cookies?.[PATIENT_REFRESH_COOKIE]);
    res.clearCookie(PATIENT_REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: env.isProd, sameSite: cookieOptions.sameSite });
    res.json({ success: true, message: "تم تسجيل الخروج." });
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

patientAccountRouter.get(
  "/appointments",
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.listMyAppointments(req.user!.id);
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
