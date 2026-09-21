import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { createNotification } from "../notifications/notifications.service";
import { previewOf, sanitizeMessageContent } from "./messaging.util";

/**
 * مراسلة الإدارة ↔ الطبيب. القواعد الأمنية (مفروضة هنا وفي المسارات، لا في الواجهة):
 * - محادثة واحدة لكل طبيب، والمفتاح doctorId. الطبيب لا يمرّر doctorId أبدًا: يُشتق من الجلسة.
 * - senderId وsenderRole يُحدَّدان من req.user فقط، ولا يقرآن من جسم الطلب.
 * - المساعد (ASSISTANT) والمريض مرفوضان في طبقة المسار (authorize).
 */

const NEW_MESSAGE = "NEW_MESSAGE" as const;

export async function getDoctorForUser(userId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
    select: { id: true, firstName: true, lastName: true, user: { select: { isActive: true } } },
  });
  if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
  if (!doctor.user.isActive) throw ApiError.forbidden();
  return doctor;
}

async function requireDoctorForAdmin(doctorId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: { id: true, userId: true, firstName: true, lastName: true },
  });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");
  return doctor;
}

const adminTitle = (d: { firstName: string; lastName: string }) => `رسالة جديدة من د. ${d.firstName} ${d.lastName}`;
const DOCTOR_TITLE = "رسالة جديدة من الإدارة";

// ---------------------------------------------------------------- send

export async function sendMessage(params: {
  doctorId: string;
  sender: { id: string; role: Role };
  content: unknown;
  clientId?: string;
}) {
  const { doctorId, sender, clientId } = params;
  if (sender.role !== Role.ADMIN && sender.role !== Role.DOCTOR) throw ApiError.forbidden();
  const content = sanitizeMessageContent(params.content);
  const doctor = await requireDoctorForAdmin(doctorId);

  // إن أُعيد نفس الطلب (نفس clientId) نُرجع الرسالة الأولى بدل إنشاء نسخة ثانية.
  const findExisting = (conversationId: string) =>
    clientId
      ? prisma.doctorMessage.findFirst({ where: { conversationId, senderId: sender.id, clientId } })
      : Promise.resolve(null);

  const conversation = await prisma.doctorConversation.upsert({
    where: { doctorId },
    create: { doctorId },
    update: {},
  });

  const existing = await findExisting(conversation.id);
  if (existing) return { message: existing, duplicate: true };

  let message;
  try {
    [message] = await prisma.$transaction([
      prisma.doctorMessage.create({
        data: { conversationId: conversation.id, senderId: sender.id, senderRole: sender.role, content, clientId: clientId ?? null },
      }),
      prisma.doctorConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), lastMessagePreview: previewOf(content), lastSenderRole: sender.role },
      }),
    ]);
  } catch (err) {
    // سباق: طلبان بنفس clientId في اللحظة نفسها — القيد الفريد يمنع التكرار ونُرجع الفائز.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await findExisting(conversation.id);
      if (again) return { message: again, duplicate: true };
    }
    throw err;
  }

  void notifyRecipients(sender.role, doctor).catch((e) => console.error("messaging notify failed:", (e as Error).message));
  return { message, duplicate: false };
}

async function notifyRecipients(
  senderRole: Role,
  doctor: { id: string; userId: string; firstName: string; lastName: string }
) {
  // لا نضع نص الرسالة في الإشعار (يظهر على شاشة القفل)، ولا نكرّر إشعارًا غير مقروء لنفس الجهة.
  if (senderRole === Role.ADMIN) {
    await notifyOnce(doctor.userId, DOCTOR_TITLE, "لديك رسالة جديدة من الإدارة. افتح قسم الرسائل.", "/messages?focus=unread");
  } else {
    const admins = await prisma.user.findMany({ where: { role: Role.ADMIN, isActive: true }, select: { id: true } });
    const title = adminTitle(doctor);
    await Promise.all(admins.map((a) => notifyOnce(a.id, title, "لديك رسالة جديدة. افتح قسم الرسائل.", "/admin/messages")));
  }
}

async function notifyOnce(userId: string, title: string, message: string, url?: string) {
  const dup = await prisma.notification.findFirst({ where: { userId, type: NEW_MESSAGE, title, isRead: false }, select: { id: true } });
  if (dup) return;
  await createNotification(userId, NEW_MESSAGE, title, message, url);
}

// ---------------------------------------------------------------- read

export async function listMessages(doctorId: string, opts: { before?: string; limit: number }) {
  const conversation = await prisma.doctorConversation.findUnique({ where: { doctorId }, select: { id: true } });
  if (!conversation) return { items: [], hasMore: false };

  const rows = await prisma.doctorMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    select: { id: true, senderRole: true, content: true, readAt: true, createdAt: true },
  });
  const hasMore = rows.length > opts.limit;
  const items = rows.slice(0, opts.limit).reverse();
  return { items, hasMore };
}

/** يضع رسائل الطرف الآخر كمقروءة (القارئ لا يستطيع "قراءة" رسائله هو). */
export async function markRead(doctorId: string, reader: { id: string; role: Role }) {
  const opposite = reader.role === Role.ADMIN ? Role.DOCTOR : Role.ADMIN;
  const result = await prisma.doctorMessage.updateMany({
    where: { conversation: { doctorId }, senderRole: opposite, readAt: null },
    data: { readAt: new Date() },
  });

  // نُغلق إشعارات "رسالة جديدة" المقابلة أيضًا حتى لا يبقى عدّاد الإشعارات عالقًا.
  if (reader.role === Role.ADMIN) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { firstName: true, lastName: true } });
    if (doctor) {
      await prisma.notification.updateMany({
        where: { userId: reader.id, type: NEW_MESSAGE, title: adminTitle(doctor), isRead: false },
        data: { isRead: true },
      });
    }
  } else {
    await prisma.notification.updateMany({
      where: { userId: reader.id, type: NEW_MESSAGE, isRead: false },
      data: { isRead: true },
    });
  }
  return { updated: result.count };
}

// ---------------------------------------------------------------- unread summaries

export async function adminUnreadSummary() {
  const [total, grouped, latest] = await Promise.all([
    prisma.doctorMessage.count({ where: { senderRole: Role.DOCTOR, readAt: null } }),
    prisma.doctorMessage.groupBy({ by: ["conversationId"], where: { senderRole: Role.DOCTOR, readAt: null } }),
    prisma.doctorConversation.findFirst({
      where: { lastMessageAt: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      select: {
        lastMessageAt: true,
        lastMessagePreview: true,
        lastSenderRole: true,
        doctor: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);
  return {
    unread: total,
    conversationsWithUnread: grouped.length,
    latest: latest
      ? {
          doctorId: latest.doctor.id,
          doctorName: `${latest.doctor.firstName} ${latest.doctor.lastName}`,
          preview: latest.lastMessagePreview,
          fromRole: latest.lastSenderRole,
          at: latest.lastMessageAt,
        }
      : null,
  };
}

export async function doctorUnreadSummary(doctorId: string) {
  const unread = await prisma.doctorMessage.count({
    where: { conversation: { doctorId }, senderRole: Role.ADMIN, readAt: null },
  });
  return { unread };
}

export async function listAdminConversations(params: { q?: string; page: number; pageSize: number }) {
  const q = params.q?.trim();
  const where: Prisma.DoctorWhereInput = q
    ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] }
    : {};

  const [doctors, total] = await Promise.all([
    prisma.doctor.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        specialty: { select: { nameAr: true } },
        conversation: { select: { id: true, lastMessageAt: true, lastMessagePreview: true, lastSenderRole: true } },
      },
      orderBy: [{ conversation: { lastMessageAt: { sort: "desc", nulls: "last" } } }, { firstName: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.doctor.count({ where }),
  ]);

  // عدّاد غير المقروء لكل الصفحة باستعلام واحد (بدل استعلام لكل طبيب).
  const convIds = doctors.map((d) => d.conversation?.id).filter((x): x is string => !!x);
  const unreadRows = convIds.length
    ? await prisma.doctorMessage.groupBy({
        by: ["conversationId"],
        where: { conversationId: { in: convIds }, senderRole: Role.DOCTOR, readAt: null },
        _count: { _all: true },
      })
    : [];
  const unreadMap = new Map(unreadRows.map((r) => [r.conversationId, r._count._all]));

  const items = doctors.map((d) => ({
    doctorId: d.id,
    doctorName: `${d.firstName} ${d.lastName}`,
    specialty: d.specialty?.nameAr ?? null,
    lastMessageAt: d.conversation?.lastMessageAt ?? null,
    lastMessagePreview: d.conversation?.lastMessagePreview ?? null,
    lastSenderRole: d.conversation?.lastSenderRole ?? null,
    unread: d.conversation ? unreadMap.get(d.conversation.id) ?? 0 : 0,
  }));
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}
