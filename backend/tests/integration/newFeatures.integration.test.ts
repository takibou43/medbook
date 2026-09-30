/**
 * الميزات الجديدة على PostgreSQL حقيقي عبر HTTP (Express + Zod + JWT + Prisma + القيود):
 *   1) خطط علاج الأسنان   1.5) برمجة موعد عودة   2) إحالة الأطباء   3) الحساب العائلي   4) عدّاد الحجوزات.
 *
 * تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها (لا تُستعمل DATABASE_URL للإنتاج أبدًا).
 * المخطط يُطبَّق مسبقًا على قاعدة الاختبار (prisma db push) ثم ملف الترحيل 20260930120000 (للـtrigger والقيود).
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run newFeatures
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}

const DAY = 86_400_000;

describe.skipIf(!TEST_URL)("الميزات الجديدة (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: { sub: string; role: any }) => string;
  const tag = `nf${Date.now().toString(36)}`;
  const ids = {
    wilaya: "",
    wilaya2: "",
    city: "",
    city2: "",
    dental: "",
    general: "",
    users: [] as string[],
    doctors: [] as string[],
    patients: [] as string[],
  };
  type Doc = { userId: string; doctorId: string; token: string };
  type Pat = { userId: string; patientId: string; token: string };
  let dentist: Doc, dentist2: Doc, generalist: Doc, doctorW2: Doc;
  let owner: Pat, stranger: Pat;
  let adminToken = "";

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined, raw: j, headers: r.headers };
  };

  const algeriaToday = () => new Date(new Date(Date.now() + 3600e3).toISOString().slice(0, 10) + "T00:00:00Z");
  const dayStr = (offsetDays: number) => new Date(algeriaToday().getTime() + offsetDays * DAY).toISOString().slice(0, 10);

  async function mkDoctor(i: string, specialtyId: string, wilayaId = ids.wilaya, cityId = ids.city, extra: Record<string, unknown> = {}): Promise<Doc> {
    const u = await db.user.create({ data: { email: `${tag}-doc${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + i, lastName: tag, specialtyId, wilayaId, cityId,
        slotDurationMin: 20, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        subscriptionExpiresAt: new Date(Date.now() + 90 * DAY),
        schedules: { create: Array.from({ length: 7 }, (_, dow) => ({ dayOfWeek: dow, startTime: "08:00", endTime: "12:00" })) },
        ...extra,
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    return { userId: u.id, doctorId: d.id, token: sign({ sub: u.id, role: "DOCTOR" }) };
  }

  async function mkPatient(i: string): Promise<Pat> {
    const u = await db.user.create({
      data: { email: `${tag}-pat${i}@test.local`, passwordHash: "x", role: "PATIENT", phone: "06" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") },
    });
    const p = await db.patient.create({ data: { userId: u.id, firstName: "مريض" + i, lastName: tag } });
    ids.users.push(u.id);
    ids.patients.push(p.id);
    return { userId: u.id, patientId: p.id, token: sign({ sub: u.id, role: "PATIENT" }) };
  }

  let apptSeq = 0;
  /** موعد مباشر في القاعدة (وقت فريد) — يمثّل «سبق أن حجز لدى الطبيب». */
  async function mkAppt(doctorId: string, patientId: string | null, opts: { status?: string; familyMemberId?: string | null; date?: Date; createdAt?: Date } = {}) {
    apptSeq += 1;
    const h = String(13 + Math.floor(apptSeq / 6)).padStart(2, "0");
    const m = String((apptSeq % 6) * 10).padStart(2, "0");
    const status = opts.status ?? "COMPLETED";
    return db.appointment.create({
      data: {
        doctorId, patientId, date: opts.date ?? new Date(algeriaToday().getTime() - 5 * DAY), startTime: `${h}:${m}`, endTime: `${h}:${m}`,
        status: status as any, activeSlot: status === "CANCELLED" ? null : true, familyMemberId: opts.familyMemberId ?? null,
        guestFirstName: "م", guestLastName: tag, createdBy: patientId ? "PATIENT" : "GUEST",
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
  }

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL!;
    process.env.RATE_LIMIT_MAX = "1000000";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const w = await db.wilaya.create({ data: { code: tag.slice(-5) + "a", nameAr: `ولاية ${tag}` } });
    const w2 = await db.wilaya.create({ data: { code: tag.slice(-5) + "b", nameAr: `ولاية2 ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const c2 = await db.city.create({ data: { nameAr: `مدينة2 ${tag}`, wilayaId: w2.id } });
    const dental = await db.specialty.create({ data: { nameAr: `طب الأسنان ${tag}`, nameFr: "Dentisterie" } });
    const general = await db.specialty.create({ data: { nameAr: `طب عام ${tag}`, nameFr: "Médecine générale" } });
    Object.assign(ids, { wilaya: w.id, wilaya2: w2.id, city: c.id, city2: c2.id, dental: dental.id, general: general.id });

    dentist = await mkDoctor("A", dental.id);
    dentist2 = await mkDoctor("B", dental.id);
    generalist = await mkDoctor("G", general.id);
    doctorW2 = await mkDoctor("W", general.id, w2.id, c2.id);
    owner = await mkPatient("O");
    stranger = await mkPatient("S");
    const admin = await db.user.create({ data: { email: `${tag}-admin@test.local`, passwordHash: "x", role: "ADMIN" } });
    ids.users.push(admin.id);
    adminToken = sign({ sub: admin.id, role: "ADMIN" });

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (db) {
      const docIds = ids.doctors;
      const patIds = ids.patients;
      const planWhere = { OR: [{ doctorId: { in: docIds } }, { patientId: { in: patIds } }] };
      await db.dentalFollowUp.deleteMany({ where: { treatmentPlan: planWhere } });
      await db.dentalTreatmentSession.deleteMany({ where: { treatmentPlan: planWhere } });
      await db.appointment.updateMany({ where: { doctorId: { in: docIds } }, data: { treatmentPlanId: null, treatmentSessionId: null, parentAppointmentId: null } });
      await db.dentalTreatmentPlan.deleteMany({ where: planWhere });
      await db.doctorReferral.deleteMany({ where: { OR: [{ referrerDoctorId: { in: docIds } }, { referredDoctorId: { in: docIds } }] } });
      await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
      await db.smsLog.deleteMany({ where: { appointment: { doctorId: { in: docIds } } } });
      await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: docIds } } } });
      await db.appointment.deleteMany({ where: { doctorId: { in: docIds } } });
      await db.familyMember.deleteMany({ where: { ownerPatientId: { in: patIds } } });
      await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: { in: docIds } } });
      await db.doctor.deleteMany({ where: { id: { in: docIds } } });
      await db.patient.deleteMany({ where: { id: { in: patIds } } });
      await db.user.deleteMany({ where: { id: { in: ids.users } } });
      await db.specialty.deleteMany({ where: { id: { in: [ids.dental, ids.general] } } });
      await db.city.deleteMany({ where: { id: { in: [ids.city, ids.city2] } } });
      await db.wilaya.deleteMany({ where: { id: { in: [ids.wilaya, ids.wilaya2] } } });
      await db.$disconnect();
    }
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  // =====================================================================
  // 3) الحساب العائلي
  // =====================================================================
  describe("الحساب العائلي", () => {
    let memberId = "";

    it("إضافة وتعديل فرد (الاسم يُنظَّف، ownerPatientId من الجلسة)", async () => {
      const r = await call("POST", "/api/patient/family-members", { firstName: "  ياسين ", lastName: tag, relationship: "CHILD", birthDate: "2018-04-01" }, owner.token);
      expect(r.status).toBe(201);
      expect(r.data.firstName).toBe("ياسين");
      memberId = r.data.id;
      const row = await db.familyMember.findUnique({ where: { id: memberId } });
      expect(row?.ownerPatientId).toBe(owner.patientId);

      const u = await call("PATCH", `/api/patient/family-members/${memberId}`, { relationship: "SIBLING" }, owner.token);
      expect(u.status).toBe(200);
      expect(u.data.relationship).toBe("SIBLING");
      await call("PATCH", `/api/patient/family-members/${memberId}`, { relationship: "CHILD" }, owner.token);
    });

    it("مستخدم آخر لا يصل إلى فرد من حساب غيره (قراءة/تعديل/أرشفة → 404) ولا يمكن تغيير صاحبه", async () => {
      const list = await call("GET", "/api/patient/family-members", undefined, stranger.token);
      expect(list.status).toBe(200);
      expect(list.data.map((m: any) => m.id)).not.toContain(memberId);
      expect((await call("PATCH", `/api/patient/family-members/${memberId}`, { firstName: "مخترق" }, stranger.token)).status).toBe(404);
      expect((await call("DELETE", `/api/patient/family-members/${memberId}`, undefined, stranger.token)).status).toBe(404);
      expect((await call("PATCH", `/api/patient/family-members/${memberId}`, { ownerPatientId: stranger.patientId }, owner.token)).status).toBe(400);
      expect((await call("GET", "/api/patient/family-members", undefined, dentist.token)).status).toBe(403);
      const row = await db.familyMember.findUnique({ where: { id: memberId } });
      expect(row?.firstName).toBe("ياسين");
      expect(row?.ownerPatientId).toBe(owner.patientId);
    });

    it("الحجز لفرد من العائلة يعمل: familyMemberId محفوظ والاسم من قاعدة البيانات لا من الطلب", async () => {
      const r = await call(
        "POST",
        "/api/booking",
        { firstName: "اسم مزيف", lastName: "مزيف", wilayaId: ids.wilaya, specialtyId: ids.dental, doctorId: dentist.doctorId, date: dayStr(2), startTime: "08:00", exactTime: true, familyMemberId: memberId },
        owner.token
      );
      expect(r.status).toBe(201);
      const a = await db.appointment.findUnique({ where: { id: r.data.id } });
      expect(a?.patientId).toBe(owner.patientId);
      expect(a?.familyMemberId).toBe(memberId);
      expect(a?.guestFirstName).toBe("ياسين");
      expect(a?.createdBy).toBe("PATIENT");
      expect(JSON.stringify(r.raw)).not.toContain("referralCode");

      // يظهر المستفيد الصحيح في مواعيد صاحب الحساب، ويعمل الفلتر.
      const mine = await call("GET", `/api/patient/account/appointments?beneficiary=${memberId}`, undefined, owner.token);
      expect(mine.status).toBe(200);
      const item = mine.data.find((x: any) => x.id === r.data.id);
      expect(item.beneficiary).toMatchObject({ type: "FAMILY_MEMBER", name: `ياسين ${tag}`, relationship: "CHILD" });
      expect(JSON.stringify(item)).not.toContain("2018-04-01"); // لا تاريخ ميلاد
      const selfOnly = await call("GET", "/api/patient/account/appointments?beneficiary=self", undefined, owner.token);
      expect(selfOnly.data.some((x: any) => x.id === r.data.id)).toBe(false);

      // وفي قائمة الطبيب (الاسم وصلة القرابة فقط).
      const docList = await call("GET", `/api/appointments?date=${dayStr(2)}`, undefined, dentist.token);
      const docItem = docList.data.find((x: any) => x.id === r.data.id);
      expect(docItem.beneficiary.type).toBe("FAMILY_MEMBER");
      expect(docItem.familyMember).toEqual({ id: memberId, firstName: "ياسين", lastName: tag, relationship: "CHILD" });
    });

    it("familyMemberId أجنبي يُرفض (404) ولا يُنشأ موعد", async () => {
      const foreign = await call("POST", "/api/patient/family-members", { firstName: "غريب", lastName: tag, relationship: "SPOUSE" }, stranger.token);
      const before = await db.appointment.count({ where: { doctorId: dentist.doctorId } });
      const r = await call(
        "POST",
        "/api/booking",
        { firstName: "مريم", lastName: "مراد", wilayaId: ids.wilaya, specialtyId: ids.dental, doctorId: dentist.doctorId, familyMemberId: foreign.data.id },
        owner.token
      );
      expect(r.status).toBe(404);
      expect(await db.appointment.count({ where: { doctorId: dentist.doctorId } })).toBe(before);
    });

    it("الموعد الذاتي متوافق مع السابق (familyMemberId = null، createdBy = PATIENT)", async () => {
      const r = await call("POST", "/api/booking", { firstName: "سارة", lastName: "بن علي", wilayaId: ids.wilaya, specialtyId: ids.dental, doctorId: dentist.doctorId }, owner.token);
      expect(r.status).toBe(201);
      const a = await db.appointment.findUnique({ where: { id: r.data.id } });
      expect(a?.familyMemberId).toBeNull();
      expect(a?.guestFirstName).toBe("سارة");
      expect(a?.createdBy).toBe("PATIENT");
    });

    it("حجوزات الضيوف القديمة لا تتأثر (lookup + cancel بالهاتف كما هما)", async () => {
      const g = await db.appointment.create({
        data: { doctorId: dentist.doctorId, patientId: null, date: new Date(algeriaToday().getTime() + 6 * DAY), startTime: "09:40", endTime: "10:00", status: "CONFIRMED", guestFirstName: "ضيف", guestLastName: "ض", guestPhone: "0551112233", createdBy: "GUEST" },
      });
      const l = await call("GET", `/api/booking/lookup?appointmentId=${g.id}&phone=0551112233`);
      expect(l.status).toBe(200);
      expect(l.data).toHaveLength(1);
      const c = await call("PATCH", `/api/booking/${g.id}/cancel`, { phone: "0551112233" });
      expect(c.status).toBe(200);
      expect(c.data.status).toBe("CANCELLED");
    });

    it("أرشفة فرد لا تحذف مواعيده، وتمنع الحجز الجديد له، والتكرار آمن", async () => {
      const before = await db.appointment.count({ where: { familyMemberId: memberId } });
      expect(before).toBeGreaterThan(0);
      const del = await call("DELETE", `/api/patient/family-members/${memberId}`, undefined, owner.token);
      expect(del.status).toBe(200);
      expect(del.data.archivedAt).toBeTruthy();
      expect((await call("DELETE", `/api/patient/family-members/${memberId}`, undefined, owner.token)).status).toBe(200);
      expect(await db.appointment.count({ where: { familyMemberId: memberId } })).toBe(before);
      const list = await call("GET", "/api/patient/family-members", undefined, owner.token);
      expect(list.data.map((m: any) => m.id)).not.toContain(memberId);
      const r = await call("POST", "/api/booking", { firstName: "مريم", lastName: "مراد", wilayaId: ids.wilaya, specialtyId: ids.dental, doctorId: dentist.doctorId, familyMemberId: memberId }, owner.token);
      expect(r.status).toBe(404);
      // إعادة تفعيله للاختبارات اللاحقة.
      await db.familyMember.update({ where: { id: memberId }, data: { archivedAt: null } });
    });
  });

  // =====================================================================
  // 1) خطط علاج الأسنان
  // =====================================================================
  describe("خطط علاج الأسنان", () => {
    let planId = "";
    let treatedAppt = "";

    beforeAll(async () => {
      treatedAppt = (await mkAppt(dentist.doctorId, owner.patientId)).id;
    });

    it("طبيب أسنان ينشئ خطة لمريض تعامل معه", async () => {
      const r = await call("POST", "/api/doctor/treatment-plans", { patientId: owner.patientId, title: "علاج عصب الضرس", estimatedSessions: 3, estimatedTotalCost: 15000 }, dentist.token);
      expect(r.status).toBe(201);
      expect(r.data.status).toBe("ACTIVE");
      planId = r.data.id;
    });

    it("لا خطة لمريض لم يحجز لدى الطبيب", async () => {
      const r = await call("POST", "/api/doctor/treatment-plans", { patientId: stranger.patientId, title: "خطة" }, dentist.token);
      expect(r.status).toBe(403);
    });

    it("طبيب غير أسنان يُرفض (403) حتى لو تعامل مع المريض، والمساعد/المريض مرفوضان", async () => {
      await mkAppt(generalist.doctorId, owner.patientId);
      expect((await call("POST", "/api/doctor/treatment-plans", { patientId: owner.patientId, title: "خطة" }, generalist.token)).status).toBe(403);
      expect((await call("GET", "/api/doctor/treatment-plans", undefined, generalist.token)).status).toBe(403);
      expect((await call("GET", "/api/doctor/treatment-plans", undefined, owner.token)).status).toBe(403);
    });

    it("طبيب لا يرى خطة طبيب آخر ولا يعدّلها (404)", async () => {
      expect((await call("GET", `/api/doctor/treatment-plans/${planId}`, undefined, dentist2.token)).status).toBe(404);
      expect((await call("PATCH", `/api/doctor/treatment-plans/${planId}`, { title: "تعديل" }, dentist2.token)).status).toBe(404);
      const list = await call("GET", "/api/doctor/treatment-plans", undefined, dentist2.token);
      expect(list.data.map((p: any) => p.id)).not.toContain(planId);
    });

    it("لا يمكن ربط جلسة بموعد لطبيب آخر أو لمستفيد مختلف", async () => {
      const otherDocAppt = await mkAppt(dentist2.doctorId, owner.patientId);
      expect((await call("POST", `/api/doctor/treatment-plans/${planId}/sessions`, { title: "جلسة", appointmentId: otherDocAppt.id }, dentist.token)).status).toBe(400);
      const member = await db.familyMember.findFirstOrThrow({ where: { ownerPatientId: owner.patientId } });
      const memberAppt = await mkAppt(dentist.doctorId, owner.patientId, { familyMemberId: member.id });
      expect((await call("POST", `/api/doctor/treatment-plans/${planId}/sessions`, { title: "جلسة", appointmentId: memberAppt.id }, dentist.token)).status).toBe(400);
      const strangerAppt = await mkAppt(dentist.doctorId, stranger.patientId);
      expect((await call("POST", `/api/doctor/treatment-plans/${planId}/sessions`, { title: "جلسة", appointmentId: strangerAppt.id }, dentist.token)).status).toBe(400);
    });

    it("إضافة جلسات وترتيبها وإكمال جلسة، ثم متابعة بعد 6 أشهر — دون أي SMS", async () => {
      const smsBefore = await db.smsLog.count();
      const s1 = await call("POST", `/api/doctor/treatment-plans/${planId}/sessions`, { title: "تنظيف", appointmentId: treatedAppt }, dentist.token);
      expect(s1.status).toBe(201);
      const s2 = await call("POST", `/api/doctor/treatment-plans/${planId}/sessions`, { title: "حشو" }, dentist.token);
      const sessions = s2.data.sessions;
      expect(sessions.map((s: any) => s.sessionNumber)).toEqual([1, 2]);
      const order = await call("PUT", `/api/doctor/treatment-plans/${planId}/sessions/order`, { sessionIds: [sessions[1].id, sessions[0].id] }, dentist.token);
      expect(order.data.sessions.map((s: any) => s.title)).toEqual(["حشو", "تنظيف"]);
      const done = await call("PATCH", `/api/doctor/treatment-sessions/${sessions[0].id}`, { status: "COMPLETED", notes: "ملاحظة داخلية" }, dentist.token);
      expect(done.status).toBe(200);
      expect(done.data.sessions.find((s: any) => s.id === sessions[0].id).completedAt).toBeTruthy();
      const f = await call("POST", `/api/doctor/treatment-plans/${planId}/follow-ups`, { afterMonths: 6 }, dentist.token);
      expect(f.status).toBe(201);
      expect(f.data.followUps).toHaveLength(1);
      expect(f.data.followUps[0].status).toBe("DUE");
      expect(await db.smsLog.count()).toBe(smsBefore);
    });

    it("المريض يرى خطته فقط، بلا ملاحظات الطبيب، ولا يستطيع تعديلها", async () => {
      const mine = await call("GET", "/api/patient/treatment-plans", undefined, owner.token);
      expect(mine.status).toBe(200);
      expect(mine.data.map((p: any) => p.id)).toContain(planId);
      expect(JSON.stringify(mine.data)).not.toContain("ملاحظة داخلية");
      expect((await call("GET", `/api/patient/treatment-plans/${planId}`, undefined, stranger.token)).status).toBe(404);
      const others = await call("GET", "/api/patient/treatment-plans", undefined, stranger.token);
      expect(others.data.map((p: any) => p.id)).not.toContain(planId);
      expect((await call("PATCH", `/api/doctor/treatment-plans/${planId}`, { title: "x" }, owner.token)).status).toBe(403);
    });

    it("خطة لفرد من عائلة المريض ممكنة، ولفرد من عائلة أخرى مرفوضة", async () => {
      const member = await db.familyMember.findFirstOrThrow({ where: { ownerPatientId: owner.patientId } });
      expect((await call("POST", "/api/doctor/treatment-plans", { patientId: owner.patientId, familyMemberId: member.id, title: "تقويم" }, dentist.token)).status).toBe(201);
      const foreign = await db.familyMember.findFirstOrThrow({ where: { ownerPatientId: stranger.patientId } });
      expect((await call("POST", "/api/doctor/treatment-plans", { patientId: owner.patientId, familyMemberId: foreign.id, title: "تقويم" }, dentist.token)).status).toBe(403);
    });
  });

  // =====================================================================
  // 1.5) برمجة موعد عودة
  // =====================================================================
  describe("برمجة موعد عودة", () => {
    let parent: { id: string; updatedAt: Date; status: string };
    const followDate = () => dayStr(3);

    beforeAll(async () => {
      const p = await mkAppt(dentist.doctorId, owner.patientId, { status: "COMPLETED" });
      parent = { id: p.id, updatedAt: p.updatedAt, status: p.status };
    });

    it("ينشئ موعدًا CONFIRMED من نوع FOLLOW_UP مرتبطًا بالأصلي دون تعديله، ويظهر للطبيب والمريض، مع إشعار داخلي بلا SMS", async () => {
      const smsBefore = await db.smsLog.count();
      const r = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: followDate(), startTime: "08:00", notes: "مراجعة", idempotencyKey: randomUUID() }, dentist.token);
      expect(r.status).toBe(201);
      expect(r.data).toMatchObject({ status: "CONFIRMED", type: "FOLLOW_UP", createdBy: "DOCTOR", parentAppointmentId: parent.id });
      const row = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
      expect(row.createdByUserId).toBe(dentist.userId);
      const original = await db.appointment.findUniqueOrThrow({ where: { id: parent.id } });
      expect(original.updatedAt.getTime()).toBe(parent.updatedAt.getTime());
      expect(original.status).toBe(parent.status);

      const docList = await call("GET", `/api/appointments?date=${followDate()}`, undefined, dentist.token);
      expect(docList.data.map((a: any) => a.id)).toContain(r.data.id);
      const mine = await call("GET", "/api/patient/account/appointments", undefined, owner.token);
      expect(mine.data.find((a: any) => a.id === r.data.id)?.beneficiary.type).toBe("SELF");

      const n = await db.notification.findFirst({ where: { userId: owner.userId, appointmentId: r.data.id } });
      expect(n?.type).toBe("APPOINTMENT_FOLLOW_UP_SCHEDULED");
      expect(n?.message).toContain("برمج لك الدكتور");
      expect(await db.smsLog.count()).toBe(smsBefore);
      const audit = await db.auditLog.findFirst({ where: { action: "FOLLOW_UP_APPOINTMENT_CREATED", entityId: r.data.id } });
      expect(audit).toBeTruthy();
    });

    it("طبيب بلا علاقة بالمريض لا يستطيع (موعد طبيب آخر → 404)", async () => {
      const r = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: followDate(), startTime: "09:00", idempotencyKey: randomUUID() }, dentist2.token);
      expect(r.status).toBe(404);
    });

    it("فرد عائلة من حساب آخر مرفوض (403)، وفرد من نفس العائلة باختيار صريح مقبول", async () => {
      const foreign = await db.familyMember.findFirstOrThrow({ where: { ownerPatientId: stranger.patientId } });
      const bad = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: followDate(), startTime: "09:00", familyMemberId: foreign.id, idempotencyKey: randomUUID() }, dentist.token);
      expect(bad.status).toBe(403);
      const own = await db.familyMember.findFirstOrThrow({ where: { ownerPatientId: owner.patientId, archivedAt: null } });
      const ok = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: followDate(), startTime: "09:00", familyMemberId: own.id, idempotencyKey: randomUUID() }, dentist.token);
      expect(ok.status).toBe(201);
      expect(ok.data.beneficiary.type).toBe("FAMILY_MEMBER");
      const mine = await call("GET", `/api/patient/account/appointments?beneficiary=${own.id}`, undefined, owner.token);
      expect(mine.data.map((a: any) => a.id)).toContain(ok.data.id);
    });

    it("الوقت المحجوز → 409 برسالة واضحة، والتسابق على نفس الوقت يعطي فائزًا واحدًا فقط", async () => {
      const taken = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: followDate(), startTime: "08:00", idempotencyKey: randomUUID() }, dentist.token);
      expect(taken.status).toBe(409);
      expect(taken.message).toBe("هذا الموعد حُجز للتو، يرجى اختيار وقت آخر.");
      const rs = await Promise.all(
        Array.from({ length: 6 }, () => call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: followDate(), startTime: "10:00", idempotencyKey: randomUUID() }, dentist.token))
      );
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
      const d = new Date(followDate() + "T00:00:00Z");
      expect(await db.appointment.count({ where: { doctorId: dentist.doctorId, date: d, startTime: "10:00", status: { not: "CANCELLED" } } })).toBe(1);
    });

    it("يرفض الماضي، وخارج الدوام، ويوم العطلة", async () => {
      expect((await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: dayStr(-1), startTime: "08:00", idempotencyKey: randomUUID() }, dentist.token)).status).toBe(400);
      expect((await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: followDate(), startTime: "15:00", idempotencyKey: randomUUID() }, dentist.token)).status).toBe(400);
      await db.doctorSchedule.create({ data: { doctorId: dentist.doctorId, isException: true, exceptionDate: new Date(dayStr(4) + "T00:00:00Z"), isOff: true, startTime: "00:00", endTime: "23:59" } });
      const off = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: dayStr(4), startTime: "08:00", idempotencyKey: randomUUID() }, dentist.token);
      expect(off.status).toBe(400);
      expect(off.message).toBe("هذا الوقت خارج أوقات عمل الطبيب أو في يوم عطلة.");
    });

    it("إعادة نفس الطلب (نفس المفتاح) لا تنشئ موعدين", async () => {
      const key = randomUUID();
      const body = { date: dayStr(5), startTime: "11:00", idempotencyKey: key };
      const [a, b] = await Promise.all([
        call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, body, dentist.token),
        call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, body, dentist.token),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.data.id).toBe(b.data.id);
      const c = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, body, dentist.token);
      expect(c.status).toBe(200);
      expect(c.raw.replayed).toBe(true);
      expect(await db.appointment.count({ where: { idempotencyKey: key } })).toBe(1);
    });

    it("تحويل متابعة خطة الأسنان إلى موعد: SCHEDULED (لا COMPLETED)، وإلغاء الموعد يعيدها DUE", async () => {
      const plan = await db.dentalTreatmentPlan.findFirstOrThrow({ where: { doctorId: dentist.doctorId, patientId: owner.patientId, familyMemberId: null } });
      const fu = await db.dentalFollowUp.create({ data: { treatmentPlanId: plan.id, dueDate: new Date(dayStr(30) + "T00:00:00Z") } });
      const r = await call(
        "POST",
        `/api/doctor/appointments/${parent.id}/follow-up`,
        { date: dayStr(6), startTime: "08:20", treatmentPlanId: plan.id, dentalFollowUpId: fu.id, idempotencyKey: randomUUID() },
        dentist.token
      );
      expect(r.status).toBe(201);
      let f = await db.dentalFollowUp.findUniqueOrThrow({ where: { id: fu.id } });
      expect(f.status).toBe("SCHEDULED");
      expect(f.appointmentId).toBe(r.data.id);

      // المريض يلغي وفق السياسة الحالية (DELETE /api/appointments/:id).
      const c = await call("DELETE", `/api/appointments/${r.data.id}`, undefined, owner.token);
      expect(c.status).toBe(200);
      f = await db.dentalFollowUp.findUniqueOrThrow({ where: { id: fu.id } });
      expect(f.status).toBe("DUE");
      expect(f.appointmentId).toBeNull();
      // الموعد الأصلي باقٍ كما هو.
      expect((await db.appointment.findUniqueOrThrow({ where: { id: parent.id } })).status).toBe(parent.status);
    });

    it("طبيب اشتراكه غير فعّال لا يبرمج مواعيد", async () => {
      await db.doctor.update({ where: { id: dentist.doctorId }, data: { subscriptionStatus: "EXPIRED" } });
      const r = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, { date: dayStr(7), startTime: "08:00", idempotencyKey: randomUUID() }, dentist.token);
      expect(r.status).toBe(403);
      await db.doctor.update({ where: { id: dentist.doctorId }, data: { subscriptionStatus: "ACTIVE" } });
    });
  });

  // =====================================================================
  // 2) إحالة الأطباء
  // =====================================================================
  describe("إحالة الأطباء", () => {
    let code = "";
    const registerBody = (i: string, referralCode?: string) => ({
      email: `${tag}-reg${i}@test.local`, password: "Secret123!", firstName: "طبيب", lastName: "جديد" + i,
      specialtyId: ids.general, wilayaId: ids.wilaya, cityId: ids.city, ...(referralCode !== undefined ? { referralCode } : {}),
    });
    async function trackRegistered(email: string) {
      const u = await db.user.findUnique({ where: { email }, include: { doctor: true } });
      if (u) {
        ids.users.push(u.id);
        if (u.doctor) ids.doctors.push(u.doctor.id);
      }
      return u;
    }

    it("كود الطبيب يُولَّد مرة واحدة وثابت", async () => {
      const a = await call("GET", "/api/doctor/referrals/me", undefined, generalist.token);
      expect(a.status).toBe(200);
      code = a.data.code;
      expect(code).toMatch(/^MB-/);
      const b = await call("GET", "/api/doctor/referrals/me", undefined, generalist.token);
      expect(b.data.code).toBe(code);
      expect((await call("POST", "/api/doctor/referrals/validate-code", { code: code.toLowerCase() })).data).toEqual({ valid: true });
      expect((await call("POST", "/api/doctor/referrals/validate-code", { code: "MB-ZZZZZZZZ" })).data).toEqual({ valid: false });
    });

    it("كود غير صحيح: 400 على الحقل referralCode ولا يُنشأ الحساب", async () => {
      const r = await call("POST", "/api/auth/register/doctor", registerBody("bad", "MB-WRONG999"));
      expect(r.status).toBe(400);
      expect(r.raw.details).toMatchObject({ field: "referralCode", code: "INVALID_REFERRAL_CODE" });
      expect(await db.user.findUnique({ where: { email: `${tag}-regbad@test.local` } })).toBeNull();
    });

    it("كود صالح يُحفظ مرة واحدة، والتسجيل وحده لا يمنح مكافأة", async () => {
      const before = await db.doctor.findUniqueOrThrow({ where: { id: generalist.doctorId } });
      const r = await call("POST", "/api/auth/register/doctor", registerBody("1", code));
      expect(r.status).toBe(201);
      const u = await trackRegistered(`${tag}-reg1@test.local`);
      const ref = await db.doctorReferral.findUniqueOrThrow({ where: { referredDoctorId: u!.doctor!.id } });
      expect(ref).toMatchObject({ referrerDoctorId: generalist.doctorId, status: "PENDING", referralCodeUsed: code, rewardDays: 30 });
      const after = await db.doctor.findUniqueOrThrow({ where: { id: generalist.doctorId } });
      expect(after.subscriptionExpiresAt?.getTime()).toBe(before.subscriptionExpiresAt?.getTime());
      // الطبيب المُحال لا يُحتسب مرتين (قيد فريد).
      await expect(
        db.doctorReferral.create({ data: { referrerDoctorId: dentist.doctorId, referredDoctorId: u!.doctor!.id, referralCodeUsed: "x" } })
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("الإحالة الذاتية مرفوضة (قيد قاعدة البيانات)", async () => {
      await expect(
        db.doctorReferral.create({ data: { referrerDoctorId: dentist2.doctorId, referredDoctorId: dentist2.doctorId, referralCodeUsed: "x" } })
      ).rejects.toThrow();
    });

    it("التوثيق يمنح 30 يومًا من تاريخ انتهاء الاشتراك الفعّال، مرة واحدة فقط حتى مع إعادة التوثيق والتزامن", async () => {
      const u = await db.user.findUniqueOrThrow({ where: { email: `${tag}-reg1@test.local` }, include: { doctor: true } });
      // اشتراك فعّال ينتهي بعد نهاية أي تجربة مجانية عامة، حتى تبدأ الإضافة من تاريخ انتهائه بالضبط.
      await db.doctor.update({ where: { id: generalist.doctorId }, data: { subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date(Date.now() + 400 * DAY) } });
      const before = await db.doctor.findUniqueOrThrow({ where: { id: generalist.doctorId } });
      const rs = await Promise.all([
        call("PATCH", `/api/admin/doctors/${u.doctor!.id}/verify`, { status: "VERIFIED" }, adminToken),
        call("PATCH", `/api/admin/doctors/${u.doctor!.id}/verify`, { status: "VERIFIED" }, adminToken),
      ]);
      expect(rs.every((r) => r.status === 200)).toBe(true);
      const again = await call("PATCH", `/api/admin/doctors/${u.doctor!.id}/verify`, { status: "VERIFIED" }, adminToken);
      expect(again.status).toBe(200);
      const after = await db.doctor.findUniqueOrThrow({ where: { id: generalist.doctorId } });
      expect(after.subscriptionExpiresAt!.getTime() - before.subscriptionExpiresAt!.getTime()).toBe(30 * DAY);
      expect(after.subscriptionStatus).toBe("ACTIVE");
      const ref = await db.doctorReferral.findUniqueOrThrow({ where: { referredDoctorId: u.doctor!.id } });
      expect(ref.status).toBe("REWARDED");
      expect(await db.auditLog.count({ where: { action: "REFERRAL_REWARDED", entityId: ref.id } })).toBe(1);
      const me = await call("GET", "/api/doctor/referrals/me", undefined, generalist.token);
      expect(me.data.referrals[0].status).toBe("REWARDED");
      const adminList = await call("GET", "/api/admin/referrals", undefined, adminToken);
      expect(adminList.data.items.some((i: any) => i.id === ref.id)).toBe(true);
    });

    it("اشتراك منتهٍ: 30 يومًا من الآن ويصبح ACTIVE", async () => {
      await db.doctor.update({ where: { id: dentist2.doctorId }, data: { subscriptionStatus: "EXPIRED", subscriptionExpiresAt: new Date(Date.now() - 10 * DAY) } });
      const c = (await call("GET", "/api/doctor/referrals/me", undefined, dentist2.token)).data.code;
      await call("POST", "/api/auth/register/doctor", registerBody("2", c));
      const u = await trackRegistered(`${tag}-reg2@test.local`);
      const t0 = Date.now();
      await call("PATCH", `/api/admin/doctors/${u!.doctor!.id}/verify`, { status: "VERIFIED" }, adminToken);
      const d = await db.doctor.findUniqueOrThrow({ where: { id: dentist2.doctorId } });
      expect(d.subscriptionStatus).toBe("ACTIVE");
      const expected = t0 + 30 * DAY;
      // هامش لحالة التجربة المجانية العامة السارية (تبدأ الإضافة من نهايتها) — وإلا ± دقيقة.
      expect(d.subscriptionExpiresAt!.getTime()).toBeGreaterThanOrEqual(expected - 60_000);
    });

    it("rollback: فشل بعد تحويل الإحالة داخل نفس المعاملة لا يترك REWARDED بلا تمديد", async () => {
      await db.doctor.update({ where: { id: dentist.doctorId }, data: { subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date(Date.now() + 5 * DAY) } });
      const c = (await call("GET", "/api/doctor/referrals/me", undefined, dentist.token)).data.code;
      await call("POST", "/api/auth/register/doctor", registerBody("3", c));
      const u = await trackRegistered(`${tag}-reg3@test.local`);
      const before = await db.doctor.findUniqueOrThrow({ where: { id: dentist.doctorId } });
      const { prisma } = await import("../../src/lib/prisma");
      const { grantReferralRewardTx } = await import("../../src/modules/referrals/referrals.service");
      await expect(
        prisma.$transaction(async (tx) => {
          const g = await grantReferralRewardTx(tx, u!.doctor!.id, null);
          expect(g).not.toBeNull();
          throw new Error("فشل مصطنع بعد المنح");
        })
      ).rejects.toThrow("فشل مصطنع");
      const ref = await db.doctorReferral.findUniqueOrThrow({ where: { referredDoctorId: u!.doctor!.id } });
      expect(ref.status).toBe("PENDING");
      const after = await db.doctor.findUniqueOrThrow({ where: { id: dentist.doctorId } });
      expect(after.subscriptionExpiresAt?.getTime()).toBe(before.subscriptionExpiresAt?.getTime());
    });
  });

  // =====================================================================
  // 4) عدّاد الحجوزات
  // =====================================================================
  describe("عدّاد الحجوزات العلني", () => {
    it("يحسب الشهر الحالي فقط، ويستبعد CANCELLED، وفلتر الولاية صحيح، ولا يعيد أي بيانات شخصية", async () => {
      const { __clearPublicStatsMemo, countMonthlyBookings } = await import("../../src/modules/publicStats/publicStats.service");
      const { algeriaMonthRange } = await import("../../src/lib/algeriaMonth");
      const now = new Date();
      const { start } = algeriaMonthRange(now);
      const w2Before = await countMonthlyBookings(ids.wilaya2, now);
      // 12 هذا الشهر (منها 2 ملغاة) + 3 من الشهر الماضي (قبل البداية بدقيقة) لطبيب الولاية 2.
      for (let i = 0; i < 12; i++) await mkAppt(doctorW2.doctorId, owner.patientId, { status: i < 2 ? "CANCELLED" : "CONFIRMED", createdAt: new Date(Math.max(start.getTime() + 60_000, now.getTime() - 1000 * i)) });
      for (let i = 0; i < 3; i++) await mkAppt(doctorW2.doctorId, owner.patientId, { status: "CONFIRMED", createdAt: new Date(start.getTime() - 60_000) });
      expect(await countMonthlyBookings(ids.wilaya2, now)).toBe(w2Before + 10);

      __clearPublicStatsMemo();
      const r = await call("GET", `/api/public/stats/bookings?wilayaId=${ids.wilaya2}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("public, max-age=300");
      expect(Object.keys(r.data).sort()).toEqual(["count", "definition", "displayCount", "displayText", "level", "period", "scope", "wilayaId", "wilayaName"].sort());
      expect(r.data).toMatchObject({ scope: "WILAYA", wilayaId: ids.wilaya2, definition: "NON_CANCELLED_CREATED_THIS_MONTH" });
      const serialized = JSON.stringify(r.raw);
      // لا معرّفات أطباء/مرضى ولا أسماء ولا تخصصات ولا مدن — فقط اسم الولاية المطلوبة نفسها.
      for (const secret of [doctorW2.doctorId, owner.patientId, "مريض", `مدينة2 ${tag}`]) expect(serialized).not.toContain(secret);
      expect(serialized).not.toMatch(/firstName|lastName|phone|email|specialty|city/);

      const national = await call("GET", "/api/public/stats/bookings");
      expect(national.status).toBe(200);
      expect(national.data.scope).toBe("NATIONAL");
      expect(national.data.wilayaId).toBeNull();
      expect((await call("GET", "/api/public/stats/bookings?wilayaId=not-a-uuid")).status).toBe(400);
    });
  });
});
