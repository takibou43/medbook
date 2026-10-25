import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { phoneChangeLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { Role, AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import * as appointmentsService from "../appointments/appointments.service";
import { redactPatientResponse } from "../../lib/redact";

const router = Router();
router.use(authenticate, authorize(Role.PATIENT));

router.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const patient = await prisma.patient.findUnique({
      where: { userId: req.user!.id },
      include: { user: { select: { email: true, phone: true } }, city: { include: { wilaya: true } } },
    });
    if (!patient) throw ApiError.notFound("الملف الشخصي غير موجود.");
    res.json({ success: true, data: patient });
  })
);

const updateProfileSchema = z.object({
  firstName: z.string().min(2).max(60).optional(),
  lastName: z.string().min(2).max(60).optional(),
  birthDate: z.coerce.date().optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  cityId: z.string().uuid().optional(),
  // نفس قاعدة التسجيل والحجز: رقم جزائري 05/06/07 + 8 أرقام (كان أي نص حتى 20 خانة).
  phone: z.string().trim().regex(/^0[5-7][0-9]{8}$/, "رقم هاتف جزائري غير صالح (مثال: 0551234567)").optional(),
});

router.patch(
  "/profile",
  validate({ body: updateProfileSchema }),
  phoneChangeLimiter,
  asyncHandler(async (req, res) => {
    const { phone, ...patientData } = req.body;
    const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
    if (!patient) throw ApiError.notFound("الملف الشخصي غير موجود.");

    if (patientData.cityId) {
      const city = await prisma.city.findUnique({ where: { id: patientData.cityId }, select: { id: true } });
      if (!city) throw ApiError.badRequest("البلدية المختارة غير موجودة.");
    }

    // الملف والهاتف معًا: رقم مستخدم مسبقًا (P2002) لا يترك تعديل الملف محفوظًا نصفيًا.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.patient.update({
        where: { id: patient.id },
        data: patientData,
        include: { city: { include: { wilaya: true } } },
      });
      if (phone) await tx.user.update({ where: { id: req.user!.id }, data: { phone } });
      return row;
    });

    res.json({ success: true, data: updated });
  })
);

// GET /api/patient/appointments — alias صريح كما ورد في المواصفة (نفس منطق GET /api/appointments للمريض)
router.get(
  "/appointments",
  asyncHandler(async (req, res) => {
    const status = req.query.status as AppointmentStatus | undefined;
    const data = await appointmentsService.listForPatient(req.user!.id, status);
    res.json({ success: true, data: redactPatientResponse(data) });
  })
);

// إحصائيات لوحة المريض
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
    if (!patient) throw ApiError.notFound("الملف الشخصي غير موجود.");

    const [upcoming, past, cancelled] = await Promise.all([
      prisma.appointment.count({ where: { patientId: patient.id, status: { in: ["PENDING", "CONFIRMED"] } } }),
      prisma.appointment.count({ where: { patientId: patient.id, status: "COMPLETED" } }),
      prisma.appointment.count({ where: { patientId: patient.id, status: "CANCELLED" } }),
    ]);

    res.json({ success: true, data: { upcomingAppointments: upcoming, pastAppointments: past, cancelledAppointments: cancelled } });
  })
);

export default router;
