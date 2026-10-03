import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "mock-public";
  process.env.VAPID_PRIVATE_KEY = "mock-private";
  let revoked = false;
  const db = {
    refreshToken: {
      findFirst: vi.fn(async () => ({ id: "session", revoked: false, expiresAt: new Date(Date.now() + 60000) })),
      update: vi.fn(async () => { revoked = true; return {}; }),
      updateMany: vi.fn(async () => { if (revoked) return { count: 0 }; revoked = true; return { count: 1 }; }),
      create: vi.fn(async () => ({})),
    },
    user: { findUnique: vi.fn(async () => ({ id: "patient-user", role: "PATIENT", isActive: true, patient: { id: "p" } })) },
    patient: { findUnique: vi.fn(async () => ({ id: "p" })) },
    appointmentFinancial: { findUnique: vi.fn(async () => ({ priceDzd: 1500 })) },
    patientBlock: { findUnique: vi.fn(async () => null) },
    pushSubscription: { upsert: vi.fn(async () => ({ id: "s" })), findMany: vi.fn(async () => []), delete: vi.fn() },
    appointment: { findUnique: vi.fn(async () => ({ id: "a", date: new Date("2099-01-01"), startTime: "08:00", status: "CONFIRMED", guestFirstName: "PRIVATE", guestLastName: "PATIENT", doctor: { slotDurationMin: 20 } })) },
  };
  return { db, reset: () => { revoked = false; }, send: vi.fn() };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: h.send } }));
import pushRoutes from "../src/modules/push/push.routes";
import { errorHandler } from "../src/middleware/errorHandler";
import { signAccessToken, signRefreshToken } from "../src/utils/jwt";
import { refresh, login } from "../src/modules/auth/auth.service";
import * as passwordUtils from "../src/utils/password";
import { refreshPatientSession } from "../src/modules/patientAuth/patientAuth.service";
import { pushSubscriptionSchema } from "../src/modules/patientAuth/patientAuth.schema";
import { sendPushToUser } from "../src/lib/push";
import { getAppointmentQueueStatus } from "../src/modules/booking/booking.service";

const app = express();
app.use(express.json(), pushRoutes, errorHandler);
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u", auth: "tBHItJI5svbpez7KI4CCXg" };
beforeEach(() => { vi.clearAllMocks(); h.reset(); });

describe("security audit regression", () => {
  it("performs a password comparison for unknown professional accounts", async () => {
    h.db.user.findUnique.mockResolvedValueOnce(null as any);
    const compare = vi.spyOn(passwordUtils, "comparePassword").mockResolvedValueOnce(false);
    try {
      await expect(login("missing@example.test", "Wrong@123")).rejects.toMatchObject({ statusCode: 401 });
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare.mock.calls[0][1]).toMatch(/^\$2/);
    } finally { compare.mockRestore(); }
  });
  it("does not disclose disabled accounts to someone with the wrong password", async () => {
    h.db.user.findUnique.mockResolvedValueOnce({ id: "disabled", isActive: false, passwordHash: "synthetic" } as any);
    const compare = vi.spyOn(passwordUtils, "comparePassword").mockResolvedValueOnce(false);
    try {
      await expect(login("disabled@example.test", "Wrong@123")).rejects.toMatchObject({ statusCode: 401 });
      expect(compare).toHaveBeenCalledTimes(1);
    } finally { compare.mockRestore(); }
  });
  it("prevents HTTP caching of session responses and unauthenticated errors", async () => {
    const server = (await import("../src/app")).createApp();
    const logout = await request(server).post("/api/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.headers["cache-control"]).toBe("no-store");
    const protectedResponse = await request(server).get("/api/auth/me");
    expect(protectedResponse.status).toBe(401);
    expect(protectedResponse.headers["cache-control"]).toBe("no-store");
  });
  it.each(["http://127.0.0.1:5432/internal", "https://127.0.0.1/internal", "https://attacker.example/push", "https://fcm.googleapis.com.attacker.example/x", "https://user:pass@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"])("rejects arbitrary push destination %s on both registration paths", async endpoint => {
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys }).success).toBe(false);
    const r = await request(app).post("/subscribe").set("Authorization", "Bearer " + signAccessToken({ sub: "patient-user", role: "PATIENT" })).send({ endpoint, keys });
    expect(r.status).toBe(400);
    expect(h.db.pushSubscription.upsert).not.toHaveBeenCalled();
  });
  it("accepts a real provider endpoint", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/synthetic-device";
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys }).success).toBe(true);
    expect((await request(app).post("/subscribe").set("Authorization", "Bearer " + signAccessToken({ sub: "patient-user", role: "PATIENT" })).send({ endpoint, keys })).status).toBe(201);
  });
  it("never sends persisted malicious endpoints", async () => {
    h.db.pushSubscription.findMany.mockResolvedValueOnce([{ id: "unsafe", endpoint: "https://127.0.0.1/internal", p256dh: keys.p256dh, auth: keys.auth }] as any);
    expect(await sendPushToUser("patient-user", { title: "synthetic", body: "test" })).toEqual({ sent: 0, removed: 0 });
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each([refresh, refreshPatientSession])("consumes each refresh token only once under concurrent calls", async renew => {
    const token = signRefreshToken({ sub: "patient-user" });
    const results = await Promise.allSettled([renew(token), renew(token)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(h.db.refreshToken.create).toHaveBeenCalledTimes(1);
  });
  it("public queue response does not disclose patient identity", async () => {
    const r = await getAppointmentQueueStatus("a");
    expect(JSON.stringify(r)).not.toContain("PRIVATE");
    expect(r).not.toHaveProperty("patientName");
    expect(r).toHaveProperty("startTime", "08:00");
    expect(r).toHaveProperty("priceDzd", 1500);
    expect(JSON.stringify(r)).not.toMatch(/SharePercent|clinicTerms|financial/);
  });
  it("does not log request bodies from parser errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await request(app).post("/subscribe").set("Content-Type", "application/json").send('{"password":"SYNTHETIC_PRIVATE_PASSWORD",');
      expect(JSON.stringify(log.mock.calls)).not.toContain("SYNTHETIC_PRIVATE_PASSWORD");
    } finally { log.mockRestore(); }
  });
  it("rejects an access token immediately after account deactivation", async () => {
    h.db.user.findUnique.mockResolvedValueOnce({ id: "patient-user", role: "PATIENT", isActive: false } as any);
    const r = await request(app).post("/subscribe").set("Authorization", "Bearer " + signAccessToken({ sub: "patient-user", role: "PATIENT" })).send({ endpoint: "https://fcm.googleapis.com/fcm/send/device", keys });
    expect(r.status).toBe(401);
    expect(h.db.pushSubscription.upsert).not.toHaveBeenCalled();
  });
  it("untrusted browser origins cannot mutate cookie-authenticated sessions", async () => {
    const server = (await import("../src/app")).createApp();
    const r = await request(server).post("/api/auth/logout").set("Origin", "https://attacker.example").set("Cookie", "medbook_refresh=synthetic-token");
    expect(r.status).toBe(403);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(h.db.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
