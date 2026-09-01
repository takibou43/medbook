import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError";
import { Prisma } from "@prisma/client";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `المسار غير موجود: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "بيانات غير صالحة.",
      errors: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
    });
  }

  // Known Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "القيمة مستخدمة مسبقًا (تعارض في البيانات).", meta: err.meta });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "العنصر غير موجود." });
    }
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ success: false, message: err.message, details: err.details });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({ success: false, message: "حدث خطأ غير متوقع في الخادم." });
}
