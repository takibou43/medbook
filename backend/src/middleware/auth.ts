import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { verifyAccessToken } from "../utils/jwt";
import { ApiError } from "../utils/ApiError";
import { prisma } from "../lib/prisma";
import { holdsContext } from "../lib/accountProfiles";
import { assistantDoctorContext } from "../lib/assistantDoctorContext";

export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** يتحقق من صلاحية Access Token في هيدر Authorization: Bearer <token> */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(ApiError.unauthorized());
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    // JWT validity alone does not reflect account deactivation or a changed role.
    return prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, isActive: true } })
      .then(async (user) => {
        if (!user || !user.isActive) return next(ApiError.unauthorized());
        // الدور داخل التوكن هو «سياق الجلسة». يطابق دور الحساب الأصلي عادةً؛ وللحساب ذي الملفين
        // (طبيب يملك ملف مريض أو العكس) يُقبل السياق الآخر فقط إن كان الملف موجودًا فعلًا الآن.
        // أي سياق آخر (مثل ADMIN لحساب مريض) يُرفض كما كان.
        const ok = user.role === payload.role || (await holdsContext(user.id, user.role, payload.role));
        if (!ok) return next(ApiError.forbidden());
        req.user = { id: user.id, role: payload.role };
        const selectedDoctor = req.get("X-Assistant-Doctor-Id");
        if (selectedDoctor && (selectedDoctor.length > 100 || !/^[a-zA-Z0-9-]+$/.test(selectedDoctor))) return next(ApiError.forbidden());
        return assistantDoctorContext.run(payload.role === Role.ASSISTANT ? selectedDoctor : undefined, next);
      }).catch(next);
  } catch {
    return next(ApiError.unauthorized("جلسة منتهية أو غير صالحة. الرجاء تسجيل الدخول من جديد."));
  }
}

/** مثل authenticate لكنه لا يفشل إن لم يوجد توكن — مفيد للمسارات العامة التي تتغيّر بحسب المستخدم (مثل MedBook AI) */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = verifyAccessToken(header.slice("Bearer ".length));
      return prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, isActive: true } })
        .then(async (user) => {
          if (user?.isActive && (user.role === payload.role || (await holdsContext(user.id, user.role, payload.role)))) {
            req.user = { id: user.id, role: payload.role };
          }
          next();
        }).catch(next);
    } catch {
      // ignore invalid token on optional routes
    }
  }
  next();
}

/**
 * للمسارات التي تعمل للضيف وللمستخدم المسجّل معًا (مثل إنشاء حجز): بلا ترويسة Authorization يمرّ
 * الطلب كضيف، أما إن أُرسل توكن غير صالح/منتهٍ فنرد 401 — حتى تجدّد الواجهة الجلسة وتعيد الطلب
 * بدل أن يُحفظ حجز مريض مسجَّل كحجز ضيف بصمت لمجرد انتهاء صلاحية التوكن (15 دقيقة).
 */
export function authenticateIfPresent(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
}

/** يقيّد الوصول لأدوار محددة. استخدم بعد authenticate. */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    return next();
  };
}
