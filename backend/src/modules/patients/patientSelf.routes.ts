import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { Role, AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import * as appointmentsService from "../appointments/appointments.service";

const router = Router();
router.use(authenticate, authorize(Role.PATIENT));

router.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const patient = await prisma.patient.findUnique({
      where: { userId: req.user!.id },
      include: { user: { select: { email: true, phone: true } }, city: true } as any,
    });
    if (!patient) throw ApiError.notFound("الملف الشخصي غير موجود.");
    res.json({ success: true, data: patient });
  })
);

const updateProfileSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  birthDate: z.coerce.date().optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  cityId: z.string().uuid().optional(),
  phone: z.string().optional(),
});

router.patch(
  "/profile",
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const { phone, ...patientData } = req.body;
    const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
    if (!patient) throw ApiError.notFound("الملف الشخصي غير موجود.");

    const updated = await prisma.patient.update({ where: { id: patient.id }, data: patientData });
    if (phone) await prisma.user.update({ where: { id: req.user!.id }, data: { phone } });

    res.json({ success: true, data: updated });
  })
);

// GET /api/patient/appointments — alias صريح كما ورد في المواصفة (نفس منطق GET /api/appointments للمريض)
router.get(
  "/appointments",
  asyncHandler(async (req, res) => {
    const status = req.query.status as AppointmentStatus | undefined;
    const data = await appointmentsService.listForPatient(req.user!.id, status);
    res.json({ success: true, data });
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
