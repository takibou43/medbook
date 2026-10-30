import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

/**
 * مسارات تعتمد على كوكي (refresh/logout) يجب ألا تُنفَّذ بطلب عابر للمواقع (CSRF)،
 * لأن الكوكي SameSite=None في الإنتاج. نرفض أي Origin خارج القائمة البيضاء (CLIENT_URL).
 * طلبات بلا Origin (أدوات الخادم/curl) تمرّ، فالمتصفحات ترسل Origin دائمًا في POST عابر للمواقع.
 */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (origin && !env.clientUrls.includes(origin)) return next(ApiError.forbidden("مصدر الطلب غير مسموح."));
  return next();
}
