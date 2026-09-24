/**
 * تقييم الطبيب من طرف المريض — على PostgreSQL حقيقي عبر HTTP (Express + JWT + الصلاحيات + القيود):
 *  COMPLETED فقط، مرة واحدة لكل موعد (حتى مع طلبات متزامنة)، صاحب الموعد فقط، 1..5 فقط، التعليق اختياري،
 *  الطبيب يُشتق من الموعد، لوحة الطبيب (متوسط/عدد/توزيع/قائمة) بصلاحيات صحيحة، المتوسط صحيح، لا تعديل.
 * تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run reviews
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}

describe.skipIf(!TEST_URL)("تقييم الطبيب (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: { sub: string; role: any }) => string;
  const tag = `rev${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  let docA = { userId: "", doctorId: "", token: "" };
  let docB = { userId: "", doctorId: "", token: "" };
  let assistantToken = "";
  let adminToken = "";
  let patient = { userId: "", patientId: "", token: "" };
  let other = { userId: "", patientId: "", token: "" };
  let slot = 0;

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined, raw: j };
  };
  const review = (token: string | undefined, body: Record<string, unknown>) => call("POST", "/api/reviews", body, token);

  /** موعد مباشر في القاعدة بحالة معيّنة (وقت فريد لكل موعد). */
  const algeriaToday = () => new Date(new Date(Date.now() + 3600e3).toISOString().slice(0, 10) + "T00:00:00Z");
  async function mkAppt(status: string, patientId: string | null = patient.patientId, doctorId = docA.doctorId, date = new Date("2026-09-20T00:00:00Z")) {
    slot += 1;
    const h = String(Math.floor(slot / 6) % 24).padStart(2, "0");
    const m = String((slot % 6) * 10).padStart(2, "0");
    const a = await db.appointment.create({
      data: {
        doctorId,
        patientId,
        date,
        startTime: `${h}:${m}`,
        endTime: `${h}:${m}`,
        status: status as any,
        activeSlot: status === "CANCELLED" ? null : true,
        ...(patientId ? {} : { guestFirstName: "ضيف", guestLastName: "ضيف", guestPhone: "0550000000" }),
      },
    });
    return a.id;
  }

  async function mkDoctor(i: string) {
    const u = await db.user.create({ data: { email: `${tag}-doc${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + i, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 15, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    return { userId: u.id, doctorId: d.id, token: sign({ sub: u.id, role: "DOCTOR" }) };
  }

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });

    docA = await mkDoctor("A");
    docB = await mkDoctor("B");
    const au = await db.user.create({ data: { email: `${tag}-asst@test.local`, passwordHash: "x", role: "ASSISTANT" } });
    ids.users.push(au.id);
    await db.assistant.create({ data: { userId: au.id, doctorId: docA.doctorId, firstName: "مساعد", lastName: tag } });
    assistantToken = sign({ sub: au.id, role: "ASSISTANT" });
    const admin = await db.user.create({ data: { email: `${tag}-admin@test.local`, passwordHash: "x", role: "ADMIN" } });
    ids.users.push(admin.id);
    adminToken = sign({ sub: admin.id, role: "ADMIN" });

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const reg = await call("POST", "/api/patient/auth/register", { email: `${tag}-p@test.local`, password: "Secret123!", name: "سارة بن يوسف" });
    expect(reg.status).toBe(201);
    patient = { userId: reg.data.user.id, patientId: reg.data.user.patient.id, token: reg.data.accessToken };
    ids.users.push(patient.userId);
    const reg2 = await call("POST", "/api/patient/auth/register", { email: `${tag}-o@test.local`, password: "Secret123!", name: "كريم حداد" });
    other = { userId: reg2.data.user.id, patientId: reg2.data.user.patient.id, token: reg2.data.accessToken };
    ids.users.push(other.userId);
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.review.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.assistant.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: ids.users } } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } });
    await db.specialty.deleteMany({ where: { id: ids.specialty } });
    await db.city.deleteMany({ where: { id: ids.city } });
    await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
    await db.$disconnect();
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  it("1) موعد يكتمل عبر الطبيب (CONFIRMED → COMPLETED) يسمح بالتقييم، ويصل إشعار «يمكنك الآن تقييم الطبيب»", async () => {
    // موعد اليوم (إشعارات المواعيد لا تُنشأ لموعد انتهى يومه)
    const id = await mkAppt("CONFIRMED", patient.patientId, docA.doctorId, algeriaToday());
    const done = await call("PATCH", `/api/appointments/${id}`, { status: "COMPLETED" }, docA.token);
    expect(done.status).toBe(200);
    const notif = await db.notification.findFirst({ where: { userId: patient.userId, type: "APPOINTMENT_COMPLETED", appointmentId: id } });
    expect(notif?.message).toContain("يمكنك الآن تقييم الطبيب");

    // قبل التقييم: يظهر في «مواعيدي» بلا تقييم (فتظهر للمريض «كيف تقيّم الطبيب؟»)
    const before = await call("GET", "/api/patient/account/appointments", undefined, patient.token);
    expect(before.data.find((a: any) => a.id === id)).toMatchObject({ status: "COMPLETED", review: null });

    const r = await review(patient.token, { appointmentId: id, rating: 5, comment: "طبيب ممتاز" });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ appointmentId: id, doctorId: docA.doctorId, rating: 5, comment: "طبيب ممتاز" });

    const after = await call("GET", "/api/patient/account/appointments", undefined, patient.token);
    expect(after.data.find((a: any) => a.id === id).review).toMatchObject({ rating: 5, comment: "طبيب ممتاز" });
  });

  it.each(["PENDING", "CONFIRMED", "IN_PROGRESS", "LATE", "CANCELLED", "NO_SHOW"])("2) موعد %s (غير مكتمل) لا يسمح بالتقييم", async (status) => {
    const id = await mkAppt(status);
    const r = await review(patient.token, { appointmentId: id, rating: 4 });
    expect(r.status).toBe(400);
    expect(r.message).toBe("لا يمكن التقييم إلا بعد اكتمال الموعد.");
    expect(await db.review.count({ where: { appointmentId: id } })).toBe(0);
  });

  it("3) لا يستطيع المريض تقييم الموعد أكثر من مرة — متتاليًا ومع 10 طلبات متزامنة", async () => {
    const id = await mkAppt("COMPLETED");
    expect((await review(patient.token, { appointmentId: id, rating: 4 })).status).toBe(201);
    const again = await review(patient.token, { appointmentId: id, rating: 1, comment: "تغيير" });
    expect(again.status).toBe(409);
    expect(again.message).toBe("لقد قمت بتقييم هذا الموعد مسبقًا.");

    const id2 = await mkAppt("COMPLETED");
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => review(patient.token, { appointmentId: id2, rating: (i % 5) + 1 })));
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409)).toHaveLength(9);
    expect(await db.review.count({ where: { appointmentId: id2 } })).toBe(1);
    // التقييم الأول لم يتغيّر
    expect((await db.review.findUnique({ where: { appointmentId: id } }))!.rating).toBe(4);
  });

  it("4) لا يستطيع المريض تقييم موعد ليس له (مريض آخر / حجز ضيف)، ولا موعدًا غير موجود", async () => {
    const mine = await mkAppt("COMPLETED");
    const r = await review(other.token, { appointmentId: mine, rating: 1 });
    expect(r.status).toBe(403);
    expect(r.message).toBe("لا يمكنك تقييم موعد ليس لك.");
    const guest = await mkAppt("COMPLETED", null);
    expect((await review(patient.token, { appointmentId: guest, rating: 5 })).status).toBe(403);
    expect((await review(patient.token, { appointmentId: "00000000-0000-4000-8000-000000000000", rating: 5 })).status).toBe(404);
    expect((await review(patient.token, { appointmentId: "not-a-uuid", rating: 5 })).status).toBe(400);
    expect(await db.review.count({ where: { appointmentId: { in: [mine, guest] } } })).toBe(0);
  });

  it("4ب) الطبيب يُشتق من الموعد: doctorId/patientId مزوّران في الطلب يُتجاهلان", async () => {
    const id = await mkAppt("COMPLETED");
    const r = await review(patient.token, { appointmentId: id, rating: 3, doctorId: docB.doctorId, patientId: other.patientId });
    expect(r.status).toBe(201);
    const row = await db.review.findUnique({ where: { appointmentId: id } });
    expect(row).toMatchObject({ doctorId: docA.doctorId, patientId: patient.patientId });
  });

  it("4ج) الطبيب/المساعد/الإدارة/بلا توكن لا يستطيعون إنشاء تقييم", async () => {
    const id = await mkAppt("COMPLETED");
    for (const t of [docA.token, assistantToken, adminToken]) expect((await review(t, { appointmentId: id, rating: 5 })).status).toBe(403);
    expect((await review(undefined, { appointmentId: id, rating: 5 })).status).toBe(401);
    expect(await db.review.count({ where: { appointmentId: id } })).toBe(0);
  });

  it.each([0, 6, -1, 3.5, "5", null])("5) التقييم %s مرفوض (1 إلى 5 أعداد صحيحة فقط)", async (rating) => {
    const id = await mkAppt("COMPLETED");
    const r = await review(patient.token, { appointmentId: id, rating });
    expect(r.status).toBe(400);
    expect(await db.review.count({ where: { appointmentId: id } })).toBe(0);
  });

  it("5ب) التقييم بلا نجوم مرفوض، و1 و5 مقبولان", async () => {
    expect((await review(patient.token, { appointmentId: await mkAppt("COMPLETED") })).status).toBe(400);
    expect((await review(patient.token, { appointmentId: await mkAppt("COMPLETED"), rating: 1 })).status).toBe(201);
    expect((await review(patient.token, { appointmentId: await mkAppt("COMPLETED"), rating: 5 })).status).toBe(201);
  });

  it("5ج) قاعدة البيانات نفسها ترفض تقييمًا خارج 1..5 (قيد CHECK)", async () => {
    const id = await mkAppt("COMPLETED");
    await expect(db.review.create({ data: { appointmentId: id, doctorId: docA.doctorId, patientId: patient.patientId, rating: 9 } })).rejects.toThrow();
  });

  it("6) التعليق اختياري: غيابه / null / فارغ / مسافات = بلا تعليق، والنص يُحفظ منقّى، وأكثر من 1000 حرف مرفوض", async () => {
    for (const comment of [undefined, null, "", "    "]) {
      const id = await mkAppt("COMPLETED");
      const body: Record<string, unknown> = { appointmentId: id, rating: 4 };
      if (comment !== undefined) body.comment = comment;
      const r = await review(patient.token, body);
      expect(r.status).toBe(201);
      expect(r.data.comment).toBeNull();
    }
    const id = await mkAppt("COMPLETED");
    const r = await review(patient.token, { appointmentId: id, rating: 4, comment: "  شكرًا جزيلًا  " });
    expect(r.data.comment).toBe("شكرًا جزيلًا");
    const long = await mkAppt("COMPLETED");
    expect((await review(patient.token, { appointmentId: long, rating: 4, comment: "أ".repeat(1001) })).status).toBe(400);
    expect((await review(patient.token, { appointmentId: long, rating: 4, comment: "أ".repeat(1000) })).status).toBe(201);
  });

  it("7+8) لوحة الطبيب: التقييمات تظهر مع متوسط صحيح وعدد وتوزيع، ولكل طبيب تقييماته فقط", async () => {
    // طبيب B: تقييمات معروفة 5, 4, 4, 2 → المتوسط 3.75 → 3.8
    const ratings = [5, 4, 4, 2];
    for (const [i, rating] of ratings.entries()) {
      const id = await mkAppt("COMPLETED", i % 2 ? other.patientId : patient.patientId, docB.doctorId);
      const token = i % 2 ? other.token : patient.token;
      expect((await review(token, { appointmentId: id, rating, comment: i === 0 ? "رائع" : undefined })).status).toBe(201);
    }
    const r = await call("GET", "/api/doctor/reviews", undefined, docB.token);
    expect(r.status).toBe(200);
    expect(r.data.summary).toEqual({ avgRating: 3.8, reviewsCount: 4, withCommentCount: 1, distribution: { "1": 0, "2": 1, "3": 0, "4": 2, "5": 1 } });
    expect(r.data.items).toHaveLength(4);
    expect(r.data.items.map((x: any) => x.rating).sort()).toEqual([2, 4, 4, 5]);
    const withComment = r.data.items.find((x: any) => x.comment);
    expect(withComment).toMatchObject({ comment: "رائع", rating: 5, appointmentTime: expect.any(String) });
    // اسم المريض مختصر ولا بيانات حساسة
    for (const item of r.data.items) {
      expect(["سارة ب.", "كريم ح."]).toContain(item.patientName);
      expect(item).not.toHaveProperty("patientId");
      expect(JSON.stringify(item)).not.toMatch(/@test\.local|passwordHash/);
    }
    // المتوسط المخزَّن للطبيب (المستعمل في لوحة التحكم والبحث) مطابق
    const doctor = await db.doctor.findUnique({ where: { id: docB.doctorId } });
    expect(doctor!.reviewsCount).toBe(4);
    expect(doctor!.avgRating).toBeCloseTo(3.75, 5);
    const dash = await call("GET", "/api/doctor/dashboard", undefined, docB.token);
    expect(dash.data).toMatchObject({ reviewsCount: 4 });
    expect(dash.data.avgRating).toBeCloseTo(3.75, 5);

    // طبيب A لا يرى تقييمات B
    const a = await call("GET", "/api/doctor/reviews", undefined, docA.token);
    const aIds = new Set(a.data.items.map((x: any) => x.id));
    for (const item of r.data.items) expect(aIds.has(item.id)).toBe(false);
  });

  it("8ب) متوسط طبيب A محسوب من كل تقييماته بالضبط (مقارنة مع SQL)", async () => {
    const agg = await db.review.aggregate({ where: { doctorId: docA.doctorId }, _avg: { rating: true }, _count: { _all: true } });
    const r = await call("GET", "/api/doctor/reviews", undefined, docA.token);
    expect(r.data.summary.reviewsCount).toBe(agg._count._all);
    expect(r.data.summary.avgRating).toBe(Math.round((agg._avg.rating ?? 0) * 10) / 10);
    const doctor = await db.doctor.findUnique({ where: { id: docA.doctorId } });
    expect(doctor!.avgRating).toBeCloseTo(agg._avg.rating ?? 0, 5);
    expect(doctor!.reviewsCount).toBe(agg._count._all);
    const sum = Object.values(r.data.summary.distribution as Record<string, number>).reduce((x, y) => x + y, 0);
    expect(sum).toBe(agg._count._all);
  });

  it("8ج) ترقيم الصفحات في لوحة الطبيب", async () => {
    const p1 = await call("GET", "/api/doctor/reviews?page=1&pageSize=2", undefined, docB.token);
    const p2 = await call("GET", "/api/doctor/reviews?page=2&pageSize=2", undefined, docB.token);
    expect(p1.data.items).toHaveLength(2);
    expect(p2.data.items).toHaveLength(2);
    expect(p1.data.totalPages).toBe(2);
    expect(new Set([...p1.data.items, ...p2.data.items].map((x: any) => x.id)).size).toBe(4);
  });

  it("11) صلاحيات لوحة التقييمات: المساعد والمريض والإدارة ممنوعون، وبلا توكن 401", async () => {
    for (const t of [assistantToken, patient.token, adminToken]) expect((await call("GET", "/api/doctor/reviews", undefined, t)).status).toBe(403);
    expect((await call("GET", "/api/doctor/reviews")).status).toBe(401);
  });

  it("10) لا يمكن للطبيب (ولا لأحد) تعديل التقييم: لا مسار تعديل، وقاعدة البيانات ترفض UPDATE", async () => {
    const id = await mkAppt("COMPLETED");
    const created = await review(patient.token, { appointmentId: id, rating: 2, comment: "انتظار طويل" });
    const reviewId = created.data.id;
    for (const [m, t] of [["PATCH", docA.token], ["PUT", docA.token], ["DELETE", docA.token], ["PATCH", patient.token], ["PUT", patient.token]] as const) {
      const r = await call(m, `/api/reviews/${reviewId}`, { rating: 5, comment: "معدّل" }, t);
      expect(r.status).toBe(404);
    }
    // حتى الطبيب عبر مسار الإدارة: ممنوع
    expect((await call("DELETE", `/api/admin/reviews/${reviewId}`, undefined, docA.token)).status).toBe(403);
    await expect(db.review.update({ where: { id: reviewId }, data: { rating: 5 } })).rejects.toThrow(/immutable/);
    const row = await db.review.findUnique({ where: { id: reviewId } });
    expect(row).toMatchObject({ rating: 2, comment: "انتظار طويل" });
  });

  it("10ب) حذف الإدارة (إشراف) ما زال يعمل ويعيد حساب المتوسط", async () => {
    const id = await mkAppt("COMPLETED", patient.patientId, docB.doctorId);
    const created = await review(patient.token, { appointmentId: id, rating: 1 });
    let d = await db.doctor.findUnique({ where: { id: docB.doctorId } });
    expect(d!.reviewsCount).toBe(5);
    expect(d!.avgRating).toBeCloseTo(16 / 5, 5);
    expect((await call("DELETE", `/api/admin/reviews/${created.data.id}`, undefined, adminToken)).status).toBe(200);
    d = await db.doctor.findUnique({ where: { id: docB.doctorId } });
    expect(d!.reviewsCount).toBe(4);
    expect(d!.avgRating).toBeCloseTo(3.75, 5);
  });

  it("12) الصفحات العامة: اللقب مختصر، ولا معرّف مريض أو موعد", async () => {
    const pub = await call("GET", `/api/reviews/doctor/${docB.doctorId}`);
    expect(pub.status).toBe(200);
    expect(pub.data.length).toBe(4);
    for (const r of pub.data) {
      expect(r).not.toHaveProperty("patientId");
      expect(r).not.toHaveProperty("appointmentId");
      expect(["ب.", "ح."]).toContain(r.patient.lastName);
    }
    const doc = await call("GET", `/api/doctors/${docB.doctorId}`);
    expect(doc.status).toBe(200);
    for (const r of doc.data.reviews) {
      expect(r).not.toHaveProperty("patientId");
      expect(r.patient.lastName.length).toBeLessThanOrEqual(2);
    }
  });
});
