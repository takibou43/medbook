/**
 * اختبارات صلاحيات ومنطق المراسلة على مستوى HTTP الحقيقي (Express + JWT + Zod + الخدمة)،
 * مع استبدال Prisma فقط بمحاكاة — فلا تحتاج قاعدة بيانات. تفحص أن الحماية في الـBackend نفسه.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { signAccessToken } from "../src/utils/jwt";

const DOC_A = "11111111-1111-4111-8111-111111111111";
const DOC_B = "22222222-2222-4222-8222-222222222222";
const CONV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const db = vi.hoisted(() => ({
  doctor: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  doctorConversation: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  doctorMessage: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  notification: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  user: { findMany: vi.fn() },
  pushSubscription: { findMany: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
}));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));

let app: any;
const tok = (role: "ADMIN" | "DOCTOR" | "ASSISTANT" | "PATIENT", id = `user-${role}`) => `Bearer ${signAccessToken({ sub: id, role })}`;

beforeAll(async () => {
  const { createApp } = await import("../src/app");
  app = createApp();
});

beforeEach(() => {
  vi.clearAllMocks();
  db.doctor.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.userId === "user-DOCTOR") return { id: DOC_A, firstName: "أحمد", lastName: "بن علي", userId: "user-DOCTOR", user: { isActive: true } };
    if (where.userId === "user-DOCTOR-B") return { id: DOC_B, firstName: "محمد", lastName: "س", userId: "user-DOCTOR-B", user: { isActive: true } };
    if (where.id === DOC_A) return { id: DOC_A, userId: "user-DOCTOR", firstName: "أحمد", lastName: "بن علي" };
    if (where.id === DOC_B) return { id: DOC_B, userId: "user-DOCTOR-B", firstName: "محمد", lastName: "س" };
    return null;
  });
  db.doctorConversation.upsert.mockImplementation(async ({ where }: any) => ({ id: where.doctorId === DOC_A ? CONV_A : "conv-b", doctorId: where.doctorId }));
  db.doctorConversation.update.mockResolvedValue({});
  db.doctorConversation.findUnique.mockImplementation(async ({ where }: any) => (where.doctorId === DOC_A ? { id: CONV_A } : null));
  db.doctorMessage.findFirst.mockResolvedValue(null);
  db.doctorMessage.create.mockImplementation(async ({ data }: any) => ({ id: "m1", readAt: null, createdAt: new Date(), ...data }));
  db.doctorMessage.findMany.mockResolvedValue([]);
  db.doctorMessage.updateMany.mockResolvedValue({ count: 2 });
  db.doctorMessage.count.mockResolvedValue(3);
  db.notification.findFirst.mockResolvedValue(null);
  db.notification.create.mockResolvedValue({});
  db.notification.updateMany.mockResolvedValue({ count: 0 });
  db.user.findMany.mockResolvedValue([{ id: "admin-1" }]);
  db.pushSubscription.findMany.mockResolvedValue([]);
});

describe("المصادقة والصلاحيات", () => {
  it("بلا توكن => 401 على كل مسارات المراسلة", async () => {
    for (const [m, u] of [["get", "/api/admin/messages/conversations"], ["get", `/api/admin/messages/conversations/${DOC_A}/messages`], ["post", `/api/admin/messages/conversations/${DOC_A}/messages`], ["patch", `/api/admin/messages/conversations/${DOC_A}/read`], ["get", "/api/doctor/messages"], ["post", "/api/doctor/messages"], ["patch", "/api/doctor/messages/read"], ["get", "/api/doctor/messages/unread-count"]] as const) {
      const r = await (request(app) as any)[m](u).send({});
      expect(r.status, `${m} ${u}`).toBe(401);
    }
  });

  it("الطبيب لا يصل إلى أي مسار إدارة (403) ولا يقرأ محادثة طبيب آخر", async () => {
    const r1 = await request(app).get("/api/admin/messages/conversations").set("Authorization", tok("DOCTOR"));
    const r2 = await request(app).get(`/api/admin/messages/conversations/${DOC_B}/messages`).set("Authorization", tok("DOCTOR"));
    const r3 = await request(app).post(`/api/admin/messages/conversations/${DOC_B}/messages`).set("Authorization", tok("DOCTOR")).send({ content: "x" });
    expect([r1.status, r2.status, r3.status]).toEqual([403, 403, 403]);
    expect(db.doctorMessage.findMany).not.toHaveBeenCalled();
    expect(db.doctorMessage.create).not.toHaveBeenCalled();
  });

  it("المريض والمساعد مرفوضان (403) على مسارات الطبيب والإدارة", async () => {
    for (const role of ["PATIENT", "ASSISTANT"] as const) {
      expect((await request(app).get("/api/doctor/messages").set("Authorization", tok(role))).status).toBe(403);
      expect((await request(app).post("/api/doctor/messages").set("Authorization", tok(role)).send({ content: "x" })).status).toBe(403);
      expect((await request(app).get("/api/admin/messages/conversations").set("Authorization", tok(role))).status).toBe(403);
    }
    expect(db.doctorMessage.create).not.toHaveBeenCalled();
  });

  it("الإدارة لا تستطيع استعمال مسارات الطبيب (لا محادثة Admin↔Admin)", async () => {
    expect((await request(app).get("/api/doctor/messages").set("Authorization", tok("ADMIN"))).status).toBe(403);
  });
});

describe("الإرسال", () => {
  it("Admin يرسل رسالة لطبيب: 201، senderRole=ADMIN، senderId من الجلسة، ولا تكرار إشعار", async () => {
    const r = await request(app).post(`/api/admin/messages/conversations/${DOC_A}/messages`).set("Authorization", tok("ADMIN", "admin-9")).send({ content: "  مرحباً دكتور  ", clientId: CID });
    expect(r.status).toBe(201);
    const data = db.doctorMessage.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ senderId: "admin-9", senderRole: "ADMIN", content: "مرحباً دكتور", conversationId: CONV_A });
    await new Promise((r) => setTimeout(r, 20));
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create.mock.calls[0][0].data.userId).toBe("user-DOCTOR");
    // نص الرسالة لا يظهر في الإشعار
    expect(JSON.stringify(db.notification.create.mock.calls[0][0].data)).not.toContain("مرحباً دكتور");
  });

  it("الطبيب يرسل للإدارة: doctorId من الجلسة فقط، ويُتجاهل أي senderId/senderRole/doctorId في الجسم", async () => {
    const r = await request(app)
      .post("/api/doctor/messages")
      .set("Authorization", tok("DOCTOR"))
      .send({ content: "تم", senderId: "admin-1", senderRole: "ADMIN", doctorId: DOC_B, conversationId: "conv-b" });
    expect(r.status).toBe(201);
    expect(db.doctorConversation.upsert.mock.calls[0][0].where).toEqual({ doctorId: DOC_A });
    const data = db.doctorMessage.create.mock.calls[0][0].data;
    expect(data.senderId).toBe("user-DOCTOR");
    expect(data.senderRole).toBe("DOCTOR");
    expect(data.conversationId).toBe(CONV_A);
    await new Promise((r) => setTimeout(r, 20));
    expect(db.notification.create.mock.calls[0][0].data.userId).toBe("admin-1");
  });

  it("الرسالة الفارغة أو الطويلة أو بلا محتوى => 400 ولا تُحفظ", async () => {
    for (const body of [{ content: "" }, { content: "   " }, {}, { content: "a".repeat(2001) }, { content: 5 }]) {
      const r = await request(app).post("/api/doctor/messages").set("Authorization", tok("DOCTOR")).send(body);
      expect(r.status).toBe(400);
    }
    expect(db.doctorMessage.create).not.toHaveBeenCalled();
  });

  it("doctorId غير صالح أو طبيب غير موجود => 400/404", async () => {
    const bad = await request(app).post("/api/admin/messages/conversations/not-a-uuid/messages").set("Authorization", tok("ADMIN")).send({ content: "x" });
    expect(bad.status).toBe(400);
    const missing = await request(app).post("/api/admin/messages/conversations/33333333-3333-4333-8333-333333333333/messages").set("Authorization", tok("ADMIN")).send({ content: "x" });
    expect(missing.status).toBe(404);
  });

  it("إعادة الطلب بنفس clientId لا تُنشئ رسالة ثانية (200 + duplicate)", async () => {
    db.doctorMessage.findFirst.mockResolvedValueOnce({ id: "m-old", content: "مرحبا", senderRole: "DOCTOR" });
    const r = await request(app).post("/api/doctor/messages").set("Authorization", tok("DOCTOR")).send({ content: "مرحبا", clientId: CID });
    expect(r.status).toBe(200);
    expect(r.body.duplicate).toBe(true);
    expect(db.doctorMessage.create).not.toHaveBeenCalled();
  });

  it("سباق clientId (P2002 من القيد الفريد) يُحوَّل لنتيجة مكررة لا خطأ", async () => {
    const { Prisma } = await import("@prisma/client");
    db.doctorMessage.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    db.doctorMessage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "m-winner" });
    const r = await request(app).post("/api/doctor/messages").set("Authorization", tok("DOCTOR")).send({ content: "a", clientId: CID });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe("m-winner");
  });

  it("لا يُنشأ إشعار ثانٍ ما دام هناك إشعار غير مقروء لنفس الجهة", async () => {
    db.notification.findFirst.mockResolvedValue({ id: "n1" });
    await request(app).post(`/api/admin/messages/conversations/${DOC_A}/messages`).set("Authorization", tok("ADMIN")).send({ content: "a" });
    await new Promise((r) => setTimeout(r, 20));
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe("القراءة وعدّاد غير المقروء", () => {
  it("الطبيب يقرأ محادثته فقط: الاستعلام مقيَّد بـdoctorId الخاص به ولا يقبل معرّفًا خارجيًا", async () => {
    db.doctorMessage.findMany.mockResolvedValue([{ id: "m1", senderRole: "ADMIN", content: "hi", readAt: null, createdAt: new Date() }]);
    const r = await request(app).get(`/api/doctor/messages?doctorId=${DOC_B}`).set("Authorization", tok("DOCTOR"));
    expect(r.status).toBe(200);
    expect(db.doctorConversation.findUnique.mock.calls[0][0].where).toEqual({ doctorId: DOC_A });
    expect(r.body.data.items).toHaveLength(1);
  });

  it("طبيب B لا يرى رسائل طبيب A (محادثته الخاصة فقط وهي غير موجودة => قائمة فارغة)", async () => {
    const r = await request(app).get("/api/doctor/messages").set("Authorization", tok("DOCTOR", "user-DOCTOR-B"));
    expect(r.status).toBe(200);
    expect(db.doctorConversation.findUnique.mock.calls[0][0].where).toEqual({ doctorId: DOC_B });
    expect(r.body.data.items).toEqual([]);
    expect(db.doctorMessage.findMany).not.toHaveBeenCalled();
  });

  it("Admin يقرأ محادثة أي طبيب (فريق إدارة واحد) مع ترقيم صفحات hasMore", async () => {
    const rows = Array.from({ length: 31 }, (_, i) => ({ id: `m${i}`, senderRole: "DOCTOR", content: "x", readAt: null, createdAt: new Date(2026, 0, 1, 0, 31 - i) }));
    db.doctorMessage.findMany.mockResolvedValue(rows);
    const r = await request(app).get(`/api/admin/messages/conversations/${DOC_A}/messages?limit=30`).set("Authorization", tok("ADMIN"));
    expect(r.status).toBe(200);
    expect(r.body.data.items).toHaveLength(30);
    expect(r.body.data.hasMore).toBe(true);
  });

  it("limit خارج الحدود => 400 (لا تحميل كل الرسائل دفعة واحدة)", async () => {
    const r = await request(app).get("/api/doctor/messages?limit=5000").set("Authorization", tok("DOCTOR"));
    expect(r.status).toBe(400);
  });

  it("تحويل إلى مقروءة: الطبيب يقرأ رسائل ADMIN فقط وقراءة الإدارة تخصّ رسائل DOCTOR فقط", async () => {
    await request(app).patch("/api/doctor/messages/read").set("Authorization", tok("DOCTOR")).expect(200);
    expect(db.doctorMessage.updateMany.mock.calls[0][0].where).toMatchObject({ conversation: { doctorId: DOC_A }, senderRole: "ADMIN", readAt: null });
    await request(app).patch(`/api/admin/messages/conversations/${DOC_A}/read`).set("Authorization", tok("ADMIN")).expect(200);
    expect(db.doctorMessage.updateMany.mock.calls[1][0].where).toMatchObject({ conversation: { doctorId: DOC_A }, senderRole: "DOCTOR", readAt: null });
    expect(db.doctorMessage.updateMany.mock.calls[1][0].data.readAt).toBeInstanceOf(Date);
  });

  it("عدّاد غير المقروء للطبيب يعدّ رسائل الإدارة غير المقروءة في محادثته فقط", async () => {
    const r = await request(app).get("/api/doctor/messages/unread-count").set("Authorization", tok("DOCTOR"));
    expect(r.body.data.unread).toBe(3);
    expect(db.doctorMessage.count.mock.calls[0][0].where).toMatchObject({ conversation: { doctorId: DOC_A }, senderRole: "ADMIN", readAt: null });
  });

  it("عدّاد الإدارة: إجمالي غير المقروء من الأطباء + آخر رسالة", async () => {
    db.doctorMessage.groupBy.mockResolvedValue([{ conversationId: "c1" }, { conversationId: "c2" }]);
    db.doctorConversation.findFirst.mockResolvedValue({ lastMessageAt: new Date(), lastMessagePreview: "شكراً", lastSenderRole: "DOCTOR", doctor: { id: DOC_A, firstName: "أحمد", lastName: "ب" } });
    const r = await request(app).get("/api/admin/messages/unread-count").set("Authorization", tok("ADMIN"));
    expect(r.body.data).toMatchObject({ unread: 3, conversationsWithUnread: 2, latest: { doctorName: "أحمد ب", preview: "شكراً" } });
  });

  it("قائمة محادثات الإدارة: استعلام تجميعي واحد لغير المقروء (بلا N+1)", async () => {
    db.doctor.findMany.mockResolvedValue([
      { id: DOC_A, firstName: "أحمد", lastName: "ب", specialty: { nameAr: "قلب" }, conversation: { id: CONV_A, lastMessageAt: new Date(), lastMessagePreview: "x", lastSenderRole: "DOCTOR" } },
      { id: DOC_B, firstName: "محمد", lastName: "س", specialty: { nameAr: "عيون" }, conversation: null },
    ]);
    db.doctor.count.mockResolvedValue(2);
    db.doctorMessage.groupBy.mockResolvedValue([{ conversationId: CONV_A, _count: { _all: 2 } }]);
    const r = await request(app).get("/api/admin/messages/conversations?q=%D8%A3").set("Authorization", tok("ADMIN"));
    expect(r.status).toBe(200);
    expect(db.doctorMessage.groupBy).toHaveBeenCalledTimes(1);
    expect(r.body.data.items.map((i: any) => i.unread)).toEqual([2, 0]);
  });
});
