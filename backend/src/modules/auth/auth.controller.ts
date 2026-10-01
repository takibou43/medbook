import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as authService from "./auth.service";
import * as clinicsService from "../clinics/clinics.service";
import { issueTokens } from "../../lib/tokens";
import { env } from "../../config/env";

function sanitizeUser(user: any) {
  const { passwordHash, ...rest } = user;
  return rest;
}

const REFRESH_COOKIE = "medbook_refresh";
const cookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  // "none" مطلوب فعليًا في الإنتاج لأن الواجهة والخادم على نطاقين مختلفين (Vercel/Render)،
  // ويجب اقترانه بـ secure:true (متوفر هنا عبر env.isProd). في التطوير المحلي نبقي "lax"
  // لأن sameSite:"none" يتطلب https ويُرفض من المتصفح بدون secure.
  sameSite: (env.isProd ? "none" : "lax") as "none" | "lax",
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const registerPatient = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerPatient(req.body);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
  res.status(201).json({ success: true, data: { user: sanitizeUser(result.user), accessToken: result.accessToken } });
});

export const registerDoctor = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerDoctor(req.body);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
  res.status(201).json({
    success: true,
    message: "تم إنشاء الحساب. ملفك المهني قيد المراجعة من طرف الإدارة قبل الظهور للمرضى.",
    data: { user: sanitizeUser(result.user), accessToken: result.accessToken },
  });
});

export const registerClinic = asyncHandler(async (req: Request, res: Response) => {
  const user = await clinicsService.registerClinic(req.body);
  const tokens = await issueTokens(user.id, user.role);
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions);
  res.status(201).json({ success: true, data: { user: sanitizeUser(user), accessToken: tokens.accessToken } });
});
export const registerClinicDoctor = asyncHandler(async (req: Request, res: Response) => {
  const user = await clinicsService.acceptNewDoctor(req.body);
  const tokens = await issueTokens(user.id, user.role);
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions);
  res.status(201).json({ success: true, data: { user: sanitizeUser(user), accessToken: tokens.accessToken } });
});

export const registerAssistant = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerAssistant(req.body);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
  res.status(201).json({ success: true, data: { user: sanitizeUser(result.user), accessToken: result.accessToken } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
  res.json({ success: true, data: { user: sanitizeUser(result.user), accessToken: result.accessToken } });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  const result = await authService.refresh(token);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
  res.json({ success: true, data: { user: sanitizeUser(result.user), accessToken: result.accessToken } });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  await authService.logout(token);
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.json({ success: true, message: "تم تسجيل الخروج." });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.user!.id);
  res.json({ success: true, data: sanitizeUser(user) });
});

export const updateAccount = asyncHandler(async (req: Request, res: Response) => {
  const { user, sessionsRevoked } = await authService.updateAccount(req.user!.id, req.body);
  // تغيير كلمة المرور أو البريد يُبطل جلسات التحديث، لذا نمسح الكوكي ليعيد المستخدم الدخول ببياناته الجديدة.
  const relogin = sessionsRevoked;
  if (relogin) res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.json({
    success: true,
    message: relogin ? "تم تحديث بيانات الحساب. الرجاء تسجيل الدخول من جديد." : "تم تحديث بيانات الحساب.",
    data: sanitizeUser(user),
  });
});
