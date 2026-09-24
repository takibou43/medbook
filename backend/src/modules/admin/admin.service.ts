import { Prisma, Role, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { hashPassword } from "../../utils/password";
import { createNotification } from "../notifications/notifications.service";
import { algeriaTodayUTCMidnight } from "../../lib/slots";
import { env } from "../../config/env";
import { lockDoctorRow, recalcDoctorRating } from "../reviews/reviews.service";

// ---------------- Dashboard stats ----------------

export async function getStats() {
    const startOfDay = algeriaTodayUTCMidnight();
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCHours(23, 59, 59, 999);

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
                include: {
                  // حالة الحظر السارية فقط (لعرض زر حظر/إلغاء حظر في قائمة المستخدمين).
                  patient: { include: { blocks: { where: { activePatientId: { not: null } }, select: { id: true, blockedAt: true } } } },
                  doctor: { include: { specialty: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
        }),
        prisma.user.count({ where }),
      ]);

  // لا نُرسل تجزئة كلمة المرور إلى الواجهة أبدًا (حتى للإدارة).
  const safeItems = items.map(({ passwordHash: _omit, ...rest }) => rest);
  return { items: safeItems, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function setUserActive(userId: string, isActive: boolean) {
    const user = await prisma.user.update({ where: { id: userId }, data: { isActive } });
    return user;
}

export async function deleteUser(userId: string, actingAdminId?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound("المستخدم غير موجود.");

  if (actingAdminId && userId === actingAdminId) {
        throw ApiError.badRequest("لا يمكنك حذف حسابك الخاص.");
  }
    if (user.role === Role.ADMIN) {
          const admins = await prisma.user.count({ where: { role: Role.ADMIN } });
          if (admins <= 1) throw ApiError.badRequest("لا يمكن حذف آخر حساب إدارة في المنصة.");
    }

  await prisma.user.delete({ where: { id: userId } });
}

export async function purgeDemoData() {
    const demoUsers = await prisma.user.findMany({
          where: { OR: [{ email: { startsWith: "dr." } }, { email: { startsWith: "patient." } }], AND: { email: { endsWith: "@medbook.dz" } } },
          select: { id: true, role: true },
    });
    const userIds = demoUsers.map((u) => u.id);
    if (userIds.length === 0) return { users: 0, doctors: 0, patients: 0, appointments: 0, reviews: 0, clinics: 0 };

  const doctors = await prisma.doctor.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const patients = await prisma.patient.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const doctorIds = doctors.map((d) => d.id);
    const patientIds = patients.map((p) => p.id);

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
    // نفس إعادة الحساب المستعملة عند إنشاء تقييم (تحت قفل صف الطبيب) — لا متوسط قديم عند التزامن.
    await prisma.$transaction(async (tx) => {
          await lockDoctorRow(tx, review.doctorId);
          await tx.review.delete({ where: { id: reviewId } });
          await recalcDoctorRating(tx, review.doctorId);
    });
}

// ---------------- Audit log ----------------

export async function logAction(userId: string | undefined, action: string, entity?: string, entityId?: string, meta?: unknown) {
    await prisma.auditLog.create({
          data: { userId, action, entity, entityId, meta: meta as Prisma.InputJsonValue },
    });
}

// ---------------- Dashboard: appointments chart ----------------

export type SeriesRange = "7d" | "30d" | "this_month" | "last_month";
const DAY_MS = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** حدود المدى بالتقويم الجزائري (Appointment.date مخزّن كمنتصف ليل UTC ليوم التقويم). */
export function resolveSeriesRange(range: SeriesRange, today = algeriaTodayUTCMidnight()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (range) {
    case "7d":
      return { from: new Date(today.getTime() - 6 * DAY_MS), to: today };
    case "30d":
      return { from: new Date(today.getTime() - 29 * DAY_MS), to: today };
    case "this_month":
      return { from: new Date(Date.UTC(y, m, 1)), to: today };
    case "last_month":
      return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
  }
}

export async function getAppointmentsSeries(range: SeriesRange) {
  const { from, to } = resolveSeriesRange(range);
  const rows = await prisma.appointment.groupBy({
    by: ["date", "status"],
    where: { date: { gte: from, lte: to } },
    _count: { _all: true },
  });

  const points = new Map<string, { date: string; total: number; completed: number; cancelled: number; noShow: number }>();
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const k = dayKey(new Date(t));
    points.set(k, { date: k, total: 0, completed: 0, cancelled: 0, noShow: 0 });
  }
  for (const r of rows) {
    const p = points.get(dayKey(r.date));
    if (!p) continue;
    const n = r._count._all;
    p.total += n;
    if (r.status === "COMPLETED") p.completed += n;
    else if (r.status === "CANCELLED") p.cancelled += n;
    else if (r.status === "NO_SHOW") p.noShow += n;
  }
  const series = [...points.values()];
  return { range, from: dayKey(from), to: dayKey(to), total: series.reduce((s, p) => s + p.total, 0), points: series };
}

// ---------------- Dashboard: appointments list (target of the stat cards) ----------------

export type AppointmentFilter = "all" | "today" | "completed" | "cancelled";

export async function listAppointmentsAdmin(params: { filter?: AppointmentFilter; q?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.AppointmentWhereInput = {};
  if (params.filter === "today") {
    const start = algeriaTodayUTCMidnight();
    const end = new Date(start);
    end.setUTCHours(23, 59, 59, 999);
    where.date = { gte: start, lte: end };
  } else if (params.filter === "completed") where.status = "COMPLETED";
  else if (params.filter === "cancelled") where.status = "CANCELLED";

  const q = params.q?.trim();
  if (q) {
    where.OR = [
      { doctor: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } },
      { guestFirstName: { contains: q, mode: "insensitive" } },
      { guestLastName: { contains: q, mode: "insensitive" } },
      { patient: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        status: true,
        guestFirstName: true,
        guestLastName: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.appointment.count({ where }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---------------- Dashboard: recent activity (derived from real tables — no invented data) ----------------

export interface ActivityItem {
  id: string;
  type: "DOCTOR_REGISTERED" | "APPOINTMENT_CREATED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_CANCELLED" | "APPOINTMENT_COMPLETED" | "APPOINTMENT_NO_SHOW" | "APPOINTMENT_UPDATED" | "MESSAGE_RECEIVED";
  title: string;
  detail?: string;
  at: Date;
  link: string;
}

const APPT_EVENT: Record<string, { type: ActivityItem["type"]; title: string }> = {
  CONFIRMED: { type: "APPOINTMENT_CONFIRMED", title: "تأكيد موعد" },
  CANCELLED: { type: "APPOINTMENT_CANCELLED", title: "إلغاء موعد" },
  COMPLETED: { type: "APPOINTMENT_COMPLETED", title: "اكتمال موعد" },
  NO_SHOW: { type: "APPOINTMENT_NO_SHOW", title: "موعد لم يحضر" },
};

export async function getRecentActivity(limit = 15): Promise<ActivityItem[]> {
  const [doctors, appts, messages] = await Promise.all([
    prisma.doctor.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, firstName: true, lastName: true, createdAt: true, verificationStatus: true },
    }),
    prisma.appointment.findMany({
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, status: true, createdAt: true, updatedAt: true, date: true, startTime: true, doctor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.doctorMessage.findMany({
      where: { senderRole: Role.DOCTOR },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, createdAt: true, readAt: true, conversation: { select: { doctor: { select: { id: true, firstName: true, lastName: true } } } } },
    }),
  ]);

  const items: ActivityItem[] = [];
  for (const d of doctors) {
    items.push({
      id: `doc-${d.id}`,
      type: "DOCTOR_REGISTERED",
      title: "تسجيل طبيب جديد",
      detail: `د. ${d.firstName} ${d.lastName}${d.verificationStatus === "PENDING" ? " — بانتظار التحقق" : ""}`,
      at: d.createdAt,
      link: d.verificationStatus === "PENDING" ? "/admin/doctors?status=PENDING" : "/admin/doctors",
    });
  }
  for (const a of appts) {
    const created = a.updatedAt.getTime() - a.createdAt.getTime() < 2000;
    const ev = created ? { type: "APPOINTMENT_CREATED" as const, title: "إنشاء موعد" } : APPT_EVENT[a.status] ?? { type: "APPOINTMENT_UPDATED" as const, title: "تحديث موعد" };
    items.push({
      id: `appt-${a.id}-${a.updatedAt.getTime()}`,
      type: ev.type,
      title: ev.title,
      detail: `د. ${a.doctor.firstName} ${a.doctor.lastName} — ${dayKey(a.date)} ${a.startTime}`,
      at: created ? a.createdAt : a.updatedAt,
      link: "/admin/appointments",
    });
  }
  for (const m of messages) {
    const d = m.conversation.doctor;
    items.push({
      id: `msg-${m.id}`,
      type: "MESSAGE_RECEIVED",
      title: "وصول رسالة جديدة",
      detail: `من د. ${d.firstName} ${d.lastName}${m.readAt ? "" : " — غير مقروءة"}`,
      at: m.createdAt,
      link: `/admin/messages?doctor=${d.id}`,
    });
  }
  return items.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, limit);
}

// ---------------- Dashboard: real system status ----------------

type CheckState = "ok" | "warn" | "error" | "off";
export interface SystemCheck {
  key: "api" | "database" | "sms" | "push" | "bookings";
  label: string;
  state: CheckState;
  detail: string;
}

export async function getSystemStatus(): Promise<{ checkedAt: string; checks: SystemCheck[] }> {
  const checks: SystemCheck[] = [];
  checks.push({ key: "api", label: "API", state: "ok", detail: `يستجيب — مدة التشغيل منذ آخر إقلاع ${Math.floor(process.uptime() / 60)} دقيقة` });

  // فحص قاعدة البيانات الفعلي: استعلام SELECT 1 مع قياس الزمن.
  let dbOk = false;
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
    const ms = Date.now() - t0;
    checks.push({ key: "database", label: "قاعدة البيانات", state: ms > 1500 ? "warn" : "ok", detail: `متصلة — زمن الاستجابة ${ms}ms` });
  } catch {
    checks.push({ key: "database", label: "قاعدة البيانات", state: "error", detail: "تعذّر الاتصال بقاعدة البيانات" });
  }

  // SMS: لا نملك فحص اتصال بمزوّد الرسائل بلا إرسال فعلي (مكلف)، لذا نعرض حالة الإعداد + آخر نتائج الإرسال الفعلية.
  const smsConfigured = !!(env.sms.budgetsmsUsername && env.sms.budgetsmsUserId && env.sms.budgetsmsHandle);
  if (!smsConfigured) {
    checks.push({ key: "sms", label: "الرسائل النصية SMS", state: "off", detail: "غير مُفعّلة (بيانات المزوّد غير مضبوطة)" });
  } else if (dbOk) {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [sent, failed] = await Promise.all([
      prisma.smsLog.count({ where: { sentAt: { gte: since }, status: "SENT" } }),
      prisma.smsLog.count({ where: { sentAt: { gte: since }, status: "FAILED" } }),
    ]);
    checks.push({
      key: "sms",
      label: "الرسائل النصية SMS",
      state: failed > 0 && failed >= sent ? "warn" : "ok",
      detail: `مُهيّأة — آخر 7 أيام: ${sent} ناجحة، ${failed} فاشلة (الحالة من سجل الإرسال، لا فحص مباشر للمزوّد)`,
    });
  } else {
    checks.push({ key: "sms", label: "الرسائل النصية SMS", state: "warn", detail: "مُهيّأة — تعذّر قراءة سجل الإرسال" });
  }

  checks.push({
    key: "push",
    label: "إشعارات المتصفح",
    state: env.push.vapidPublicKey && env.push.vapidPrivateKey ? "ok" : "off",
    detail: env.push.vapidPublicKey && env.push.vapidPrivateKey ? "مفعّلة على الخادم" : "غير مُفعّلة (مفاتيح VAPID غير مضبوطة)",
  });

  if (dbOk) {
    try {
      const [last, last24h] = await Promise.all([
        prisma.appointment.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        prisma.appointment.count({ where: { createdAt: { gte: new Date(Date.now() - DAY_MS) } } }),
      ]);
      checks.push({
        key: "bookings",
        label: "الحجوزات",
        state: "ok",
        detail: last ? `${last24h} حجز خلال آخر 24 ساعة — آخر حجز ${last.createdAt.toISOString()}` : "لا توجد حجوزات بعد",
      });
    } catch {
      checks.push({ key: "bookings", label: "الحجوزات", state: "error", detail: "تعذّر قراءة بيانات الحجوزات" });
    }
  } else {
    checks.push({ key: "bookings", label: "الحجوزات", state: "error", detail: "غير متاحة لأن قاعدة البيانات لا تستجيب" });
  }
  return { checkedAt: new Date().toISOString(), checks };
}

// ---------------- Dashboard: global search (bounded: min 2 chars, 5 results per kind) ----------------

export async function globalSearch(qRaw: string) {
  const q = qRaw.trim();
  if (q.length < 2) return { doctors: [], patients: [], appointments: [], messages: [] };
  const ci = (field: string) => ({ [field]: { contains: q, mode: "insensitive" as const } });

  const [doctors, patients, appointments, messages] = await Promise.all([
    prisma.doctor.findMany({
      where: { OR: [ci("firstName"), ci("lastName")] },
      take: 5,
      select: { id: true, firstName: true, lastName: true, specialty: { select: { nameAr: true } } },
    }),
    prisma.patient.findMany({
      where: { OR: [ci("firstName"), ci("lastName"), { user: { phone: { contains: q } } }] },
      take: 5,
      select: { id: true, firstName: true, lastName: true, user: { select: { phone: true } } },
    }),
    prisma.appointment.findMany({
      where: { OR: [ci("guestFirstName"), ci("guestLastName"), { patient: { OR: [ci("firstName"), ci("lastName")] } }] },
      orderBy: { date: "desc" },
      take: 5,
      select: {
        id: true, date: true, startTime: true, status: true, guestFirstName: true, guestLastName: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.doctorMessage.findMany({
      where: { content: { contains: q, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, content: true, createdAt: true, conversation: { select: { doctor: { select: { id: true, firstName: true, lastName: true } } } } },
    }),
  ]);
  return {
    doctors,
    patients: patients.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.user.phone })),
    appointments,
    messages: messages.map((m) => ({
      id: m.id,
      doctorId: m.conversation.doctor.id,
      doctorName: `${m.conversation.doctor.firstName} ${m.conversation.doctor.lastName}`,
      preview: m.content.length > 80 ? `${m.content.slice(0, 80)}…` : m.content,
      createdAt: m.createdAt,
    })),
  };
}
