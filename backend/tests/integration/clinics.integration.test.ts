import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
const url = process.env.TEST_DATABASE_URL;
const tag = `clinic-test-${Date.now()}`;
describe.skipIf(!url)("Clinic ownership, invitations and shared subscriptions (local PostgreSQL)", () => {
  let db: PrismaClient; let app: ReturnType<typeof import("../../src/app").createApp>;
  let sign: typeof import("../../src/utils/jwt").signAccessToken;
  let location: { wilayaId: string; cityId: string }; let specialtyId: string; let adminToken: string;
  let serial = 0; const owners: string[] = [];
  const email = () => `user-${serial++}.${tag}@example.test`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const clinicProfile = () => ({ nameAr: `عيادة ${tag}`, address: "شارع الاختبار المحلي", ...location });
  const doctorProfile = () => ({ firstName: "أمين", lastName: `اختبار-${serial++}`, specialtyId });
  async function owner(practises = true) {
    const response = await request(app).post("/api/auth/register/clinic").send({ email: email(), password: "ClinicTest123!", clinic: clinicProfile(), ...(practises ? { doctor: doctorProfile() } : {}) });
    expect(response.status).toBe(201); expect(response.body.data.user.passwordHash).toBeUndefined();
    const user = response.body.data.user; owners.push(user.id);
    return { user, clinicId: user.ownedClinic.id as string, token: response.body.data.accessToken as string };
  }
  async function invite(token: string, targetEmail = email()) {
    const response = await request(app).post("/api/clinics/mine/invites").set(bearer(token)).send({ email: targetEmail });
    expect(response.status).toBe(201); expect(response.body.data.invite.tokenHash).toBeUndefined();
    return response.body.data.rawToken as string;
  }
  const accept = (token: string) => request(app).post("/api/auth/register/clinic-doctor").send({ token, password: "ClinicTest123!", doctor: doctorProfile() });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !["/medbook_clinic_test", "/medbook_clinic_test_v2", "/medbook_security_test"].includes(parsed.pathname)) throw new Error("Only explicitly named isolated loopback test databases are allowed");
    process.env.DATABASE_URL = url!; process.env.RATE_LIMIT_MAX = "1000000"; process.env.NODE_ENV = "test";
    process.env.BUDGETSMS_USERNAME = ""; process.env.BUDGETSMS_USERID = ""; process.env.BUDGETSMS_HANDLE = "";
    process.env.VAPID_PUBLIC_KEY = ""; process.env.VAPID_PRIVATE_KEY = "";
    db = new PrismaClient({ datasourceUrl: url });
    const wilaya = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: tag } });
    const city = await db.city.create({ data: { nameAr: tag, wilayaId: wilaya.id } });
    const specialty = await db.specialty.create({ data: { nameAr: tag } });
    location = { wilayaId: wilaya.id, cityId: city.id }; specialtyId = specialty.id;
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const admin = await db.user.create({ data: { email: email(), passwordHash: "unused-test-only", role: "ADMIN" } });
    adminToken = sign({ sub: admin.id, role: "ADMIN" });
    app = (await import("../../src/app")).createApp();
  }, 60000);
  afterAll(async () => {
    if (!db || !location) return;
    await db.clinic.deleteMany({ where: { ownerId: { in: owners } } });
    await db.appointment.deleteMany({ where: { doctor: { user: { email: { endsWith: `.${tag}@example.test` } } } } });
    await db.user.deleteMany({ where: { email: { endsWith: `.${tag}@example.test` } } });
    await db.specialty.delete({ where: { id: specialtyId } });
    await db.city.delete({ where: { id: location.cityId } });
    await db.wilaya.delete({ where: { id: location.wilayaId } });
    await db.$disconnect();
    const { prisma } = await import("../../src/lib/prisma"); await prisma.$disconnect();
  });
  it("uses one account and counts a practising owner once", async () => {
    const o = await owner(); expect(o.user.role).toBe("DOCTOR");
    const response = await request(app).get("/api/clinics/mine").set(bearer(o.token));
    expect(response.body.data.billing).toMatchObject({ doctorCount: 1, monthlyTotal: 4000 });
    expect(response.body.data.doctors[0].id).toBe(o.user.doctor.id);
  });
  it("does not bill an owner who only manages the clinic", async () => {
    const o = await owner(false); expect(o.user.role).toBe("CLINIC_OWNER"); expect(o.user.doctor).toBeNull();
    const response = await request(app).get("/api/clinics/mine").set(bearer(o.token));
    expect(response.body.data.billing.monthlyTotal).toBe(0);
  });
  it("enforces owner and admin isolation and rejects self-activation", async () => {
    const a = await owner(); const b = await owner();
    expect((await request(app).get(`/api/clinics/mine/doctors/${b.user.doctor.id}/assistants`).set(bearer(a.token))).status).toBe(404);
    expect((await request(app).get("/api/clinics/admin/list").set(bearer(a.token))).status).toBe(403);
    expect((await request(app).get("/api/clinics/mine")).status).toBe(401);
    expect((await request(app).patch("/api/clinics/mine").set(bearer(a.token)).send({ ...clinicProfile(), subscriptionStatus: "ACTIVE" })).status).toBe(400);
    const assistant = sign({ sub: a.user.id, role: "ASSISTANT" });
    expect((await request(app).get("/api/clinics/mine").set(bearer(assistant))).status).toBe(403);
  });
  it("prevents selecting a clinic through independent registration", async () => {
    const o = await owner();
    const response = await request(app).post("/api/auth/register/doctor").send({ email: email(), password: "ClinicTest123!", ...doctorProfile(), ...location, clinicId: o.clinicId });
    expect(response.status).toBe(403);
  });
  it("consumes each invitation once under concurrent acceptance", async () => {
    const o = await owner(); const token = await invite(o.token);
    const responses = await Promise.all([accept(token), accept(token)]);
    expect(responses.filter(r => r.status === 201)).toHaveLength(1);
    expect(responses.every(r => [201, 400, 409].includes(r.status))).toBe(true);
    expect(await db.doctor.count({ where: { clinicId: o.clinicId } })).toBe(2);
    const stored = await db.clinicDoctorInvite.findFirst({ where: { clinicId: o.clinicId } });
    expect(stored?.tokenHash).not.toBe(token); expect(stored?.status).toBe("ACCEPTED");
  });
  it("blocks cancelled invitations and invalid paid subscription activation", async () => {
    const o = await owner(); const token = await invite(o.token);
    const row = await db.clinicDoctorInvite.findFirstOrThrow({ where: { clinicId: o.clinicId } });
    expect((await request(app).delete(`/api/clinics/mine/invites/${row.id}`).set(bearer(o.token))).status).toBe(200);
    expect((await accept(token)).status).toBe(400);
    expect((await request(app).patch(`/api/clinics/admin/${o.clinicId}`).set(bearer(adminToken)).send({ subscriptionStatus: "ACTIVE", paidDoctorCount: 0, subscriptionExpiresAt: new Date(Date.now() + 86400000) })).status).toBe(400);
  });
  it("keeps a paid doctor's clinic unavailable until the clinic is reviewed and paid", async () => {
    const o = await owner(); const id = o.user.doctor.id;
    await db.doctor.update({ where: { id }, data: { verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE" } });
    expect((await request(app).get(`/api/doctors/${id}`)).status).toBe(404);
    const active = { verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", paidDoctorCount: 1, subscriptionExpiresAt: new Date(Date.now() + 86400000) };
    expect((await request(app).patch(`/api/clinics/admin/${o.clinicId}`).set(bearer(adminToken)).send(active)).status).toBe(200);
    const visible = await request(app).get(`/api/clinics/${o.clinicId}`);
    expect(visible.status).toBe(200); expect(visible.body.data.doctors).toHaveLength(1);
    expect(visible.body.data.ownerId).toBeUndefined(); expect(visible.body.data.subscriptionStatus).toBeUndefined();
    expect((await request(app).get(`/api/doctors/${id}`)).status).toBe(200);
    const namedDoctor = await db.doctor.findUniqueOrThrow({ where: { id } });
    const byName = await request(app).get("/api/doctors").query({ q: `${namedDoctor.firstName} ${namedDoctor.lastName}` });
    expect(byName.status).toBe(200); expect(byName.body.data.items.some((d: { id: string }) => d.id === id)).toBe(true);
    await db.doctorSchedule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ doctorId: id, dayOfWeek, startTime: "08:00", endTime: "18:00" })) });
    expect((await request(app).get(`/api/booking/next-slot?doctorId=${id}`)).status).toBe(200);
    const patient = await db.user.create({ data: { email: email(), passwordHash: "unused-test-only", role: "PATIENT", patient: { create: { firstName: "مريض", lastName: "الاختبار" } } } });
    const patientToken = sign({ sub: patient.id, role: "PATIENT" });
    const booking = { firstName: "مريض", lastName: "الاختبار", wilayaId: location.wilayaId, specialtyId, doctorId: id };
    expect((await request(app).post("/api/booking").set(bearer(patientToken)).send(booking)).status).toBe(201);
    await db.clinic.update({ where: { id: o.clinicId }, data: { subscriptionExpiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/booking/next-slot?doctorId=${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/doctors/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/clinics/${o.clinicId}`)).status).toBe(404);
    expect((await request(app).post("/api/booking").set(bearer(patientToken)).send(booking)).status).toBe(404);
  });
  it("does not exceed the paid capacity when different invites race", async () => {
    const o = await owner();
    await request(app).patch(`/api/clinics/admin/${o.clinicId}`).set(bearer(adminToken)).send({ subscriptionStatus: "ACTIVE", verificationStatus: "VERIFIED", paidDoctorCount: 2, subscriptionExpiresAt: new Date(Date.now() + 86400000) });
    const tokens = [await invite(o.token), await invite(o.token)];
    const responses = await Promise.all(tokens.map(t => accept(t)));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await db.doctor.count({ where: { clinicId: o.clinicId } })).toBe(2);
    expect(await db.clinicDoctorInvite.count({ where: { clinicId: o.clinicId, status: "PENDING" } })).toBe(1);
  });
  it("queues one transfer for an existing doctor and requires admin approval even when invitations race", async () => {
    const a = await owner(false); const b = await owner(false); const targetEmail = email();
    const u = await db.user.create({ data: { email: targetEmail, passwordHash: "unused-test-only", role: "DOCTOR", doctor: { create: { ...doctorProfile(), ...location } } }, include: { doctor: true } });
    const tokens = [await invite(a.token, targetEmail), await invite(b.token, targetEmail)];
    const doctorToken = sign({ sub: u.id, role: "DOCTOR" });
    const responses = await Promise.all(tokens.map(token => request(app).post("/api/clinics/invites/accept").set(bearer(doctorToken)).send({ token })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.doctor.count({ where: { clinicId: { in: [a.clinicId, b.clinicId] } } })).toBe(0);
    const pending = responses.find(r => r.status === 200)!.body.data;
    expect(pending.status).toBe("PENDING");
    expect((await request(app).patch(`/api/clinics/admin/transfers/${pending.id}`).set(bearer(doctorToken)).send({ approve: true })).status).toBe(403);
    expect((await request(app).patch(`/api/clinics/admin/transfers/${pending.id}`).set(bearer(adminToken)).send({ approve: true })).status).toBe(400);
    expect((await request(app).patch(`/api/clinics/admin/${pending.clinicId}`).set(bearer(adminToken)).send({ verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", paidDoctorCount: 1, subscriptionExpiresAt: new Date(Date.now() + 86400000) })).status).toBe(200);
    const approved = await request(app).patch(`/api/clinics/admin/transfers/${pending.id}`).set(bearer(adminToken)).send({ approve: true });
    expect(approved.status).toBe(200); expect(approved.body.data.status).toBe("ACCEPTED");
    expect(await db.doctor.count({ where: { clinicId: { in: [a.clinicId, b.clinicId] } } })).toBe(1);
    expect((await request(app).patch(`/api/clinics/admin/transfers/${pending.id}`).set(bearer(adminToken)).send({ approve: true })).status).toBe(409);
  });
  it("creating an owned clinic preserves an existing doctor's subscription until approval and rejection", async () => {
    const u = await db.user.create({ data: { email: email(), passwordHash: "unused-test-only", role: "DOCTOR", doctor: { create: { ...doctorProfile(), ...location, subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date(Date.now() + 86400000) } } }, include: { doctor: true } });
    const token = sign({ sub: u.id, role: "DOCTOR" }); owners.push(u.id);
    const created = await request(app).post("/api/clinics/mine").set(bearer(token)).send(clinicProfile());
    expect(created.status).toBe(201);
    expect(await db.doctor.findUnique({ where: { id: u.doctor!.id } })).toMatchObject({ clinicId: null, subscriptionStatus: "ACTIVE" });
    const mine = await request(app).get("/api/clinics/transfers/mine").set(bearer(token));
    expect(mine.status).toBe(200); expect(mine.body.data[0].status).toBe("PENDING");
    const pendingId = mine.body.data[0].id;
    expect((await request(app).get("/api/clinics/admin/transfers").set(bearer(token))).status).toBe(403);
    expect((await request(app).patch(`/api/clinics/admin/transfers/${pendingId}`).set(bearer(adminToken)).send({ approve: false })).status).toBe(200);
    expect(await db.doctor.findUnique({ where: { id: u.doctor!.id } })).toMatchObject({ clinicId: null, subscriptionStatus: "ACTIVE" });
    expect(await db.clinicTransferRequest.findUnique({ where: { id: pendingId } })).toMatchObject({ status: "REVOKED", pendingDoctorId: null });
  });
  it("accepts direct transfer requests but never approves beyond paid capacity under concurrency", async () => {
    const o = await owner();
    await request(app).patch(`/api/clinics/admin/${o.clinicId}`).set(bearer(adminToken)).send({ verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", paidDoctorCount: 2, subscriptionExpiresAt: new Date(Date.now() + 86400000) });
    const pending: string[] = [];
    for (let i = 0; i < 2; i++) {
      const u = await db.user.create({ data: { email: email(), passwordHash: "unused-test-only", role: "DOCTOR", doctor: { create: { ...doctorProfile(), ...location, subscriptionStatus: "ACTIVE" } } } });
      const doctorToken = sign({ sub: u.id, role: "DOCTOR" });
      const result = await request(app).post("/api/clinics/transfers").set(bearer(doctorToken)).send({ clinicId: o.clinicId });
      expect(result.status).toBe(201); pending.push(result.body.data.id);
      expect((await request(app).post("/api/clinics/transfers").set(bearer(doctorToken)).send({ clinicId: o.clinicId })).status).toBe(409);
    }
    const results = await Promise.all(pending.map(id => request(app).patch(`/api/clinics/admin/transfers/${id}`).set(bearer(adminToken)).send({ approve: true })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.doctor.count({ where: { clinicId: o.clinicId } })).toBe(2);
    expect(await db.clinicTransferRequest.count({ where: { clinicId: o.clinicId, status: "PENDING" } })).toBe(1);
  });
  it("assigns clinic assistants to the selected doctor without leaking billing", async () => {
    const o = await owner(); const id = o.user.doctor.id;
    const invited = await request(app).post(`/api/clinics/mine/doctors/${id}/assistants`).set(bearer(o.token)).send({ email: email() });
    expect(invited.status).toBe(200); expect(invited.body.data.invite.tokenHash).toBeUndefined();
    const accepted = await request(app).post("/api/auth/register/assistant").send({ token: invited.body.data.rawToken, password: "ClinicTest123!", firstName: "مساعد", lastName: "الاختبار" });
    expect(accepted.status).toBe(201); expect(accepted.body.data.user.assistant.doctor.subscriptionStatus).toBeUndefined();
    const assistantId = accepted.body.data.user.assistant.id;
    expect((await request(app).patch(`/api/clinics/mine/doctors/${id}/assistants/${assistantId}`).set(bearer(o.token)).send({ isActive: false })).status).toBe(200);
    const token = accepted.body.data.accessToken;
    expect((await request(app).get("/api/appointments/queue").set(bearer(token))).status).toBe(403);
  });
});
