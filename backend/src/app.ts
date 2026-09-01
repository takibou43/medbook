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

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.clientUrl,
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
  app.use("/api/doctor", doctorSelfRoutes);
  app.use("/api/appointments", appointmentsRoutes);
  app.use("/api/patient", patientSelfRoutes);
  app.use("/api/reviews", reviewsRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/favorites", favoritesRoutes);
  app.use("/api/admin", adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
