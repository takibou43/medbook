import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { apiLimiter } from "./middleware/rateLimiter";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

import authRoutes from "./modules/auth/auth.routes";
import specialtiesRoutes from "./modules/specialties/specialties.routes";
import wilayasRoutes from "./modules/wilayas/wilayas.routes";
import doctorsRoutes from "./modules/doctors/doctors.routes";
import doctorSelfRoutes from "./modules/doctors/doctorSelf.routes";
import appointmentsRoutes from "./modules/appointments/appointments.routes";
import patientSelfRoutes from "./modules/patients/patientSelf.routes";
import reviewsRoutes from "./modules/reviews/reviews.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import favoritesRoutes from "./modules/favorites/favorites.routes";
import adminRoutes from "./modules/admin/admin.routes";
import bookingRoutes from "./modules/booking/booking.routes";
import pushRoutes from "./modules/push/push.routes";
import assistantsRoutes from "./modules/assistants/assistants.routes";
import assistantsPublicRoutes from "./modules/assistants/assistants.public.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      // يدعم أكثر من نطاق (موقع المرضى + موقع الأطباء المنفصل)؛ يسمح أيضًا بالطلبات
      // بدون origin (مثل صحة الخادم /health أو أدوات لا تُرسل Origin).
      origin(origin, callback) {
        if (!origin || env.clientUrls.includes(origin)) return callback(null, true);
        callback(new Error("غير مسموح به بواسطة CORS"));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  if (!env.isProd) app.use(morgan("dev"));
  app.use("/api", apiLimiter);

  app.get("/health", (_req, res) => res.json({ success: true, message: "MedBook API يعمل بنجاح 🩺" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/specialties", specialtiesRoutes);
  app.use("/api/wilayas", wilayasRoutes);
  app.use("/api/doctors", doctorsRoutes);
  // إدارة المساعدين (طبيب فقط) — يجب تسجيلها قبل "/api/doctor" (الأعم) وإلا فإن Express
  // يمرّر أي طلب لـ "/api/doctor/assistants/..." عبر router الأعم أولًا بحكم ترتيب
  // التسجيل (prefix matching)، وهو ما قد يتسبب لاحقًا في تعارض مسارات مربِك عند إضافة
  // مسار جديد هناك باسم "assistants". تسجيلها هنا أولًا يجعل المطابقة صريحة لا تعتمد
  // على "سقوط" الطلب من router إلى آخر.
  app.use("/api/doctor/assistants", assistantsRoutes);
  app.use("/api/doctor", doctorSelfRoutes);
  app.use("/api/appointments", appointmentsRoutes);
  app.use("/api/patient", patientSelfRoutes);
  app.use("/api/reviews", reviewsRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/favorites", favoritesRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/booking", bookingRoutes);
  app.use("/api/push", pushRoutes);
  // مسار عام للتحقق من رمز دعوة مساعد قبل التسجيل — بدون مصادقة.
  app.use("/api/assistants", assistantsPublicRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
