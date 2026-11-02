import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError";
import { Prisma } from "@prisma/client";
import { safeErrorCode } from "../lib/safeError";

const MAX_REPORTED_ISSUES = 20;

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `المسار غير موجود: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Body-parser errors can contain the complete submitted body. Return fixed
  // messages and never log/echo those objects or trust arbitrary error statuses.
  if (err && typeof err === "object" && "type" in err && "status" in err) {
    if (err.type === "entity.too.large" && err.status === 413) {
      return res.status(413).json({ success: false, message: "حجم الطلب أكبر من الحد المسموح." });
    }
    if (err.type === "entity.parse.failed" && err.status === 400) {
      return res.status(400).json({ success: false, message: "محتوى الطلب غير صالح." });
    }
    if ((err.type === "encoding.unsupported" || err.type === "charset.unsupported") && err.status === 415) {
      return res.status(415).json({ success: false, message: "ترميز الطلب غير مدعوم." });
    }
  }
  // Zod validation errors
  if (err instanceof ZodError) {
    // A bounded list is enough for the forms; an unbounded one let a single request
    // build a multi-megabyte response.
    return res.status(400).json({
      success: false,
      message: "بيانات غير صالحة.",
      errors: err.issues.slice(0, MAX_REPORTED_ISSUES).map((e) => ({
        path: e.path.slice(0, 10).join(".").slice(0, 200),
        message: e.code === "unrecognized_keys" ? "يحتوي الطلب على حقول غير مسموح بها." : e.message.slice(0, 300),
      })),
    });
  }

  // Known Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      // لا نُرجع err.meta: يكشف أسماء القيود/الأعمدة الداخلية لقاعدة البيانات.
      return res.status(409).json({ success: false, message: "القيمة مستخدمة مسبقًا (تعارض في البيانات)." });
    }
    // نفاد اتصالات المجمّع/انتهاء مهلة المعاملة/تعذّر الوصول لقاعدة البيانات: حمل مؤقت لا خلل في الطلب.
    // نُرجع 503 + Retry-After بدل 500 حتى يعرف العميل أنه يستطيع إعادة المحاولة.
    if (["P2024", "P2028", "P1001", "P1002", "P1008", "P1017"].includes(err.code)) {
      console.error("Database busy/unreachable:", err.code);
      res.setHeader("Retry-After", "2");
      return res.status(503).json({ success: false, message: "الخادم مشغول مؤقتًا. الرجاء المحاولة بعد لحظات." });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "العنصر غير موجود." });
    }
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ success: false, message: err.message, details: err.details });
  }

  console.error("Unhandled error:", safeErrorCode(err));
  return res.status(500).json({ success: false, message: "حدث خطأ غير متوقع في الخادم." });
}
