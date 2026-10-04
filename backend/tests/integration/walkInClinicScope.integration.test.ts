/**
 * «مريض حضر بدون موعد» مع صلاحيات طاقم العيادة (PostgreSQL حقيقي):
 *  - مساعد عيادة لعدة أطباء محددين: يسجّل للطبيب المختار فقط (الترويسة)، والموعد عند ذلك الطبيب.
 *  - طبيب في نفس العيادة غير مرتبط بالمساعد، أو طبيب خارج العيادة، أو طبيب معطّل ⇒ 403 بلا أي موعد.
 *  - بلا اختيار مع أكثر من طبيب ⇒ 400 DOCTOR_REQUIRED (لا تسجيل صامت عند «أول» طبيب).
 *  - مساعد لطبيب واحد: الاختيار تلقائي (بلا ترويسة) ⇒ 201 عند طبيبه.
 *  - مساعد «كل الأطباء»: يسجّل لأي طبيب نشط في العيادة.
 * تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.REMINDERS_ENABLED = "false";
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({ statusCode: 201 })) } }));

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}
const HOUR = 3600000;

describe.skipIf(!TEST_URL)("مريض حضر بدون موعد — نطاق مساعد العيادة (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let today: Date;
  const tag = `wc${Date.now().toString(36)}`;
  const tokens = { multi: "", single: "", all: "" };
  const ids = { wilaya: "", city: "", specialty: "", clinic: "", otherClinic: "", dA: "", dB: "", dC: "", dOff: "", dX: "", users: [] as string[], doctors: [] as string[] };

  const walkIn = async (token: string, doctorHeader?: string) => {
    const r = await fetch(base + "/api/appointments/walk-in", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token, ...(doctorHeader ? { "X-Assistant-Doctor-Id": doctorHeader } : {}) },
      body: JSON.stringify({ firstName: "زائر", lastName: tag, phone: "0551234567", idempotencyKey: randomUUID() }),
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, code: j?.details?.code as string | undefined, message: j?.message as string | undefined };
  };
  const countAll = () => db.appointment.count({ where: { doctorId: { in: ids.doctors } } });

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });
    // عيادات بلا مالك: يُحتسب اشتراك كل طبيب على حدة (نفس قاعدة hasEffectiveDoctorSubscription).
    const clinic = await db.clinic.create({ data: { nameAr: `عيادة ${tag}`, address: "عنوان", wilayaId: w.id, cityId: c.id } });
    const other = await db.clinic.create({ data: { nameAr: `عيادة أخرى ${tag}`, address: "عنوان", wilayaId: w.id, cityId: c.id } });
    Object.assign(ids, { clinic: clinic.id, otherClinic: other.id });

    const mkDoctor = async (key: string, clinicId: string, active = true) => {
      const u = await db.user.create({ data: { email: `${tag}-${key}@test.local`, passwordHash: "x", role: "DOCTOR", isActive: active } });
      const d = await db.doctor.create({
        data: {
          userId: u.id, firstName: `طبيب${key}`, lastName: tag, specialtyId: s.id, wilayaId: w.id, cityId: c.id, clinicId, slotDurationMin: 5,
          verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
          schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "00:00", endTime: "23:59" })) },
        },
      });
      ids.users.push(u.id);
      ids.doctors.push(d.id);
      return d.id;
    };
    ids.dA = await mkDoctor("a", clinic.id);
    ids.dB = await mkDoctor("b", clinic.id);
    ids.dC = await mkDoctor("c", clinic.id); // في العيادة لكنه غير مُسند للمساعد المحدد
    ids.dOff = await mkDoctor("off", clinic.id, false); // مُسند لكن حسابه معطّل
    ids.dX = await mkDoctor("x", other.id); // خارج العيادة

    const mkAssistant = async (key: string, data: { allDoctors: boolean; allowedDoctorIds: string[] }) => {
      const u = await db.user.create({ data: { email: `${tag}-as-${key}@test.local`, passwordHash: "x", role: "ASSISTANT" } });
      await db.assistant.create({ data: { userId: u.id, doctorId: ids.dA, clinicId: clinic.id, firstName: "مساعد", lastName: key, ...data } });
      ids.users.push(u.id);
      return u.id;
    };
    const multi = await mkAssistant("multi", { allDoctors: false, allowedDoctorIds: [ids.dA, ids.dB, ids.dOff] });
    const single = await mkAssistant("single", { allDoctors: false, allowedDoctorIds: [ids.dB] });
    const all = await mkAssistant("all", { allDoctors: true, allowedDoctorIds: [] });

    const { signAccessToken } = await import("../../src/utils/jwt");
    tokens.multi = signAccessToken({ sub: multi, role: "ASSISTANT" } as any);
    tokens.single = signAccessToken({ sub: single, role: "ASSISTANT" } as any);
    tokens.all = signAccessToken({ sub: all, role: "ASSISTANT" } as any);
    today = (await import("../../src/lib/slots")).algeriaTodayUTCMidnight();
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    server?.close();
    if (db) {
      await db.appointmentFinancial.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } }).catch(() => undefined);
      await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
      await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
      await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
      await db.assistant.deleteMany({ where: { clinicId: ids.clinic } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids.doctors } } });
      await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
      await db.user.deleteMany({ where: { id: { in: ids.users } } });
      await db.clinic.deleteMany({ where: { id: { in: [ids.clinic, ids.otherClinic] } } });
      await db.specialty.deleteMany({ where: { id: ids.specialty } });
      await db.city.deleteMany({ where: { id: ids.city } });
      await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
      await db.$disconnect();
    }
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(today.getTime() + 9 * HOUR));
  });
  afterEach(() => vi.useRealTimers());

  it("مساعد لعدة أطباء: يسجّل للطبيب المختار، والموعد عند ذلك الطبيب بالضبط", async () => {
    const a = await walkIn(tokens.multi, ids.dA);
    expect(a.status).toBe(201);
    expect(a.data.doctorId).toBe(ids.dA);
    const b = await walkIn(tokens.multi, ids.dB);
    expect(b.status).toBe(201);
    expect(b.data.doctorId).toBe(ids.dB);
    expect(await db.appointment.count({ where: { doctorId: ids.dA } })).toBe(1);
    expect(await db.appointment.count({ where: { doctorId: ids.dB } })).toBe(1);
  });

  it("مساعد لعدة أطباء بلا اختيار ⇒ 400 DOCTOR_REQUIRED دون إنشاء شيء", async () => {
    const before = await countAll();
    const r = await walkIn(tokens.multi);
    expect(r.status).toBe(400);
    expect(r.code).toBe("DOCTOR_REQUIRED");
    expect(await countAll()).toBe(before);
  });

  it("طبيب في نفس العيادة غير مرتبط، طبيب من عيادة أخرى، أو طبيب معطّل ⇒ 403 بلا أي موعد", async () => {
    const before = await countAll();
    for (const target of [ids.dC, ids.dX, ids.dOff]) {
      const r = await walkIn(tokens.multi, target);
      expect(r.status, target).toBe(403);
    }
    expect(await countAll()).toBe(before);
    expect(await db.appointment.count({ where: { doctorId: { in: [ids.dC, ids.dX, ids.dOff] } } })).toBe(0);
  });

  it("مساعد لطبيب واحد: الاختيار تلقائي بلا ترويسة ⇒ عند طبيبه؛ واستهداف غيره ⇒ 403", async () => {
    const r = await walkIn(tokens.single);
    expect(r.status).toBe(201);
    expect(r.data.doctorId).toBe(ids.dB);
    const bad = await walkIn(tokens.single, ids.dA);
    expect(bad.status).toBe(403);
  });

  it("مساعد «كل الأطباء»: يسجّل لأي طبيب نشط في العيادة، ولا يتجاوزها", async () => {
    const r = await walkIn(tokens.all, ids.dC);
    expect(r.status).toBe(201);
    expect(r.data.doctorId).toBe(ids.dC);
    expect((await walkIn(tokens.all, ids.dX)).status).toBe(403);
    expect((await walkIn(tokens.all, ids.dOff)).status).toBe(403);
    expect((await walkIn(tokens.all)).code).toBe("DOCTOR_REQUIRED");
  });
});
