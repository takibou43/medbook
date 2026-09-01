import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as authService from "./auth.service";
import { env } from "../../config/env";

function sanitizeUser(user: any) {
  const { passwordHash, ...rest } = user;
  return rest;
}

const REFRESH_COOKIE = "medbook_refresh";
const cookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: "lax" as const,
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
