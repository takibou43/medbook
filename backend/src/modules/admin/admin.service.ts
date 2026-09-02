import { Prisma, Role, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { hashPassword } from "../../utils/password";
import { createNotification } from "../notifications/notifications.service";

// ---------------- Dashboard stats ----------------

export async function getStats() {
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const [patients, doctors, clinics, appointments, todayAppointments, completed, cancelled, pendingVerification] = await Promise.all([
    prisma.user.count({ where: { role: Role.PATIENT } }),
    prisma.user.count({ where: { role: Role.DOCTOR } }),
    prisma.clinic.count(),
    prisma.appointment.count(),
    prisma.appointment.count({ where: { date: { gte: startOfDay, lte: endOfDay } } }),
    prisma.appointment.count({ where: { status: "COMPLETED" } }),
    prisma.appointment.count({ where: { status: "CANCELLED" } }),
    prisma.doctor.count({ where: { verificationStatus: VerificationStatus.PENDING } }),
  ]);

  return { patients, doctors, clinics, appointments, todayAppointments, completed, cancelled, pendingVerification };
}

// ---------------- Users management ----------------

export async function listUsers(params: { role?: Role; q?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.UserWhereInput = {
    ...(params.role ? { role: params.role } : {}),
    ...(params.q
      ? { OR: [{ email: { contains: params.q, mode: "insensitive" } }, { phone: { contains: params.q } }] }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { patient: true, doctor: { include: { specialty: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function setUserActive(userId: string, isActive: boolean) {
  const user = await prisma.user.update({ where: { id: userId }, data: { isActive } });
  return user;
}

export async function deleteUser(userId: string) {
  await prisma.user.delete({ where: { id: userId } });
}

/**
 * حذف البيانات التجريبية التي أنشأها سكربت seed فقط.
 * النطاق محصور عمدًا في بُنية بريد الحسابات التجريبية (dr.N@medbook.dz / patient.N@medbook.dz)
 * حتى لا تمسّ العملية أي مستخدم حقيقي مهما تكرّر استدعاؤها.
 * لا تُحذف: حساب الإدارة، الولايات، البلديات، التخصصات.
 */
export async function purgeDemoData() {
  const demoUsers = await prisma.user.findMany({
    where: {
      email: { endsWith: "@medbook.dz" },
      OR: [{ email: { startsWith: "dr." } }, { email: { startsWith: "patient." } }],
    },
    select: { id: true },
  });
  const userIds = demoUsers.map((u) => u.id);
  if (userIds.length === 0) return { users: 0, doctors: 0, patients: 0, appointments: 0, reviews: 0, clinics: 0 };

  const doctors = await prisma.doctor.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const patients = await prisma.patient.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const doctorIds = doctors.map((d) => d.id);
  const patientIds = patients.map((p) => p.id);

  // الترتيب مهم: علاقات Appointment نحو Doctor/Patient ليست Cascade، لذا نحذف الأبناء أولًا.
  const reviews = await prisma.review.deleteMany({
    where: { OR: [{ doctorId: { in: doctorIds } }, { patientId: { in: patientIds } }] },
  });
  const appointments = await prisma.appointment.deleteMany({
    where: { OR: [{ doctorId: { in: doctorIds } }, { patientId: { in: patientIds } }] },
  });
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: { in: doctorIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } });
  await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
  const users = await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  // العيادات: تُحذف فقط إن لم يبقَ أي طبيب مرتبط بها.
  const clinics = await prisma.clinic.deleteMany({ where: { doctors: { none: {} } } });

  return {
    users: users.count,
    doctors: doctorIds.length,
    patients: patientIds.length,
    appointments: appointments.count,
    reviews: reviews.count,
    clinics: clinics.count,
  };
}

export async function createAdminUser(email: string, password: string, phone?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw ApiError.conflict("البريد الإلكتروني مستخدم مسبقًا.");
  const passwordHash = await hashPassword(password);
  return prisma.user.create({ data: { email, phone, passwordHash, role: Role.ADMIN } });
}

// ---------------- Doctors management ----------------

export async function listDoctorsAdmin(params: { verificationStatus?: VerificationStatus; q?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.DoctorWhereInput = {
    ...(params.verificationStatus ? { verificationStatus: params.verificationStatus } : {}),
    ...(params.q
      ? {
          OR: [
            { firstName: { contains: params.q, mode: "insensitive" } },
            { lastName: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.doctor.findMany({
      where,
      include: { specialty: true, wilaya: true, city: true, clinic: true, user: { select: { email: true, phone: true, isActive: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.doctor.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function setDoctorVerification(doctorId: string, status: VerificationStatus) {
  const doctor = await prisma.doctor.update({ where: { id: doctorId }, data: { verificationStatus: status }, include: { user: true } });

  await createNotification(
    doctor.userId,
    status === VerificationStatus.VERIFIED ? "DOCTOR_VERIFIED" : "DOCTOR_REJECTED",
    status === VerificationStatus.VERIFIED ? "تم التحقق من ملفك المهني" : "تم رفض ملفك المهني",
    status === VerificationStatus.VERIFIED
      ? "تهانينا! تم التحقق من ملفك وأصبح ظاهرًا للمرضى على المنصة."
      : "للأسف تم رفض ملفك المهني. الرجاء التواصل مع الإدارة لمزيد من المعلومات."
  );

  return doctor;
}

export async function updateDoctorAdmin(doctorId: string, data: Prisma.DoctorUpdateInput) {
  return prisma.doctor.update({ where: { id: doctorId }, data });
}

// ---------------- Specialties CRUD ----------------

export const specialtiesAdmin = {
  list: () => prisma.specialty.findMany({ orderBy: { nameAr: "asc" } }),
  create: (data: { nameAr: string; nameFr?: string; icon?: string; description?: string }) => prisma.specialty.create({ data }),
  update: (id: string, data: Partial<{ nameAr: string; nameFr: string; icon: string; description: string }>) =>
    prisma.specialty.update({ where: { id }, data }),
  remove: (id: string) => prisma.specialty.delete({ where: { id } }),
};

// ---------------- Wilayas / Cities CRUD ----------------

export const wilayasAdmin = {
  list: () => prisma.wilaya.findMany({ orderBy: { nameAr: "asc" }, include: { cities: true } }),
  create: (data: { code: string; nameAr: string; nameFr?: string }) => prisma.wilaya.create({ data }),
  update: (id: string, data: Partial<{ code: string; nameAr: string; nameFr: string }>) => prisma.wilaya.update({ where: { id }, data }),
  remove: (id: string) => prisma.wilaya.delete({ where: { id } }),
  addCity: (wilayaId: string, nameAr: string) => prisma.city.create({ data: { wilayaId, nameAr } }),
  // إضافة دفعة بلديات لولاية واحدة (لتعبئة البيانات المرجعية دفعة واحدة بدل طلب لكل بلدية).
  // نتجاهل البلديات الموجودة مسبقًا حتى تكون العملية قابلة للإعادة دون إنشاء تكرارات.
  addCitiesBulk: async (wilayaId: string, names: string[]) => {
    const wilaya = await prisma.wilaya.findUnique({ where: { id: wilayaId } });
    if (!wilaya) throw ApiError.notFound("الولاية غير موجودة.");
    const existing = await prisma.city.findMany({ where: { wilayaId }, select: { nameAr: true } });
    const existingNames = new Set(existing.map((c) => c.nameAr));
    const toCreate = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).filter((n) => !existingNames.has(n));
    if (toCreate.length > 0) {
      await prisma.city.createMany({ data: toCreate.map((nameAr) => ({ wilayaId, nameAr })) });
    }
    return { added: toCreate.length, skipped: names.length - toCreate.length, total: existingNames.size + toCreate.length };
  },
  removeCity: (id: string) => prisma.city.delete({ where: { id } }),
};

// ---------------- Reviews moderation ----------------

export async function listAllReviews() {
  return prisma.review.findMany({
    include: {
      doctor: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function deleteReview(reviewId: string) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw ApiError.notFound("التقييم غير موجود.");
  await prisma.review.delete({ where: { id: reviewId } });
  const agg = await prisma.review.aggregate({ where: { doctorId: review.doctorId }, _avg: { rating: true }, _count: { rating: true } });
  await prisma.doctor.update({
    where: { id: review.doctorId },
    data: { avgRating: agg._avg.rating ?? 0, reviewsCount: agg._count.rating },
  });
}

// ---------------- Audit log ----------------

export async function logAction(userId: string | undefined, action: string, entity?: string, entityId?: string, meta?: unknown) {
  await prisma.auditLog.create({
    data: { userId, action, entity, entityId, meta: meta as Prisma.InputJsonValue },
  });
}
