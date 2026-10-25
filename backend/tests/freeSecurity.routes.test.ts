import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  process.env.RATE_LIMIT_MAX = "2";
  process.env.TRUST_PROXY_HOPS = "1";
  return {
    userLookup: vi.fn(async ({ where }: any) => ({ id: where.id, role: where.id.startsWith("assistant-") ? "ASSISTANT" : "PATIENT", isActive: true })),
    search: vi.fn(async () => ({ items: [], total: 0 })),
    availability: vi.fn(async () => ({ slots: [] })),
    booking: vi.fn((_req: any, res: any) => res.status(201).json({ success: true })),
    preview: vi.fn((_req: any, res: any) => res.json({ success: true })),
  };
});
vi.mock("../src/lib/prisma", () => ({ prisma: { user: { findUnique: h.userLookup } } }));
vi.mock("../src/modules/booking/booking.controller", () => ({
  createGuestBooking: h.booking,
  getSlots: h.preview, getNextSlot: h.preview, getAvailability: h.preview,
  lookupBookings: h.preview, cancelBooking: h.preview, getBookingStatus: h.preview,
}));
vi.mock("../src/modules/appointments/appointments.controller", () => ({
  create: h.booking, walkIn: h.booking, listMine: h.preview, updateStatus: h.preview,
  cancel: h.preview, queue: h.preview, callNext: h.preview, markLate: h.preview,
  callPatient: h.preview, markArrived: h.preview,
}));
vi.mock("../src/modules/doctors/doctors.service", async importOriginal => ({
  ...await importOriginal<object>(), searchDoctors: h.search, getDoctorAvailability: h.availability,
}));

import bookingRoutes from "../src/modules/booking/booking.routes";
import appointmentRoutes from "../src/modules/appointments/appointments.routes";
import doctorsRoutes from "../src/modules/doctors/doctors.routes";
import { errorHandler } from "../src/middleware/errorHandler";
import { createApp } from "../src/app";
import { signAccessToken } from "../src/utils/jwt";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use("/booking", bookingRoutes);
app.use("/appointments", appointmentRoutes);
app.use("/doctors", doctorsRoutes);
app.use(errorHandler);

const id = "11111111-1111-4111-8111-111111111111";
const booking = { doctorId: id, wilayaId: id, specialtyId: id, firstName: "Test", lastName: "Patient", date: "2099-01-01", startTime: "08:00" };
const auth = (user: string, role: "PATIENT" | "ASSISTANT" = "PATIENT") => `Bearer ${signAccessToken({ sub: user, role })}`;
beforeEach(() => vi.clearAllMocks());

describe("free abuse protection at real HTTP routes", () => {
  it("shares a patient budget across both booking routes and changing IPs", async () => {
    const token = auth("patient-budget");
    for (let i = 0; i < 20; i++) {
      const r = await request(app).post(i % 2 ? "/booking" : "/appointments")
        .set("Authorization", token).set("X-Forwarded-For", `198.51.100.${i + 1}`).send(booking);
      expect(r.status).toBe(201);
    }
    const denied = await request(app).post("/booking").set("Authorization", token)
      .set("X-Forwarded-For", "203.0.113.4").send({ ...booking, doctorId: "22222222-2222-4222-8222-222222222222", familyMemberId: id });
    expect(denied.status).toBe(429);
    expect(denied.headers["retry-after"]).toBeDefined();
    expect(h.booking).toHaveBeenCalledTimes(20);
    expect((await request(app).post("/appointments").set("Authorization", token).send(booking)).status).toBe(429);
    // A family or clinic sharing an internet connection does not share accounts' budgets.
    expect((await request(app).post("/booking").set("Authorization", auth("different-patient")).set("X-Forwarded-For", "203.0.113.4").send(booking)).status).toBe(201);
  });

  it("preserves staff walk-in registration and denies unauthenticated booking", async () => {
    const token = auth("assistant-reception", "ASSISTANT");
    for (let i = 0; i < 25; i++) {
      const r = await request(app).post("/appointments/walk-in").set("Authorization", token)
        .send({ firstName: "Test", lastName: "Guest", phone: "0551234567", idempotencyKey: id });
      expect(r.status).toBe(201);
    }
    expect((await request(app).post("/booking").send(booking)).status).toBe(401);
    expect((await request(app).post("/booking").set("Authorization", token).send(booking)).status).toBe(403);
  });

  it("bounds public discovery across route aliases but keeps tracking reachable", async () => {
    const ip = "198.51.100.150";
    for (let i = 0; i < 120; i++) {
      const path = i % 2 ? `/booking/next-slot?doctorId=${id}` : "/doctors?q=Test";
      expect((await request(app).get(path).set("X-Forwarded-For", ip)).status).toBe(200);
    }
    expect((await request(app).get(`/booking/availability?doctorId=${id}`).set("X-Forwarded-For", ip)).status).toBe(429);
    expect((await request(app).get(`/booking/status/${id}`).set("X-Forwarded-For", ip)).status).toBe(200);
    expect((await request(app).get("/doctors").set("X-Forwarded-For", "198.51.100.151")).status).toBe(200);
  });
});

describe("bound public query work before accessing the database", () => {
  it.each([
    "q[not]=test", "q=test&q=other", `q=${"a".repeat(101)}`, "page=Infinity",
    "page=10001", "page=1.5", "pageSize=500", "minRating=99", "lat=Infinity&lng=6",
    "lat=91&lng=6", "lat=36&lng=-181", "specialtyId[not]=x", "gender=ADMIN",
  ])("rejects malformed/oversized search %s without calling search", async query => {
    const r = await request(app).get(`/doctors?${query}`).set("X-Forwarded-For", "198.51.100.160");
    expect(r.status).toBe(400);
    expect(h.search).not.toHaveBeenCalled();
  });

  it("preserves normal text, location filters and pagination", async () => {
    const r = await request(app).get("/doctors").query({ q: "طبيب ميلة", specialtyId: id, page: 2, pageSize: 50, lat: 36.45, lng: 6.26, maxDistanceKm: 25 });
    expect(r.status).toBe(200);
    expect(h.search).toHaveBeenCalledWith({ q: "طبيب ميلة", specialtyId: id, page: 2, pageSize: 50, lat: 36.45, lng: 6.26, maxDistanceKm: 25 });
  });

  it.each(["2026-02-30", "2026-13-01", "bad", "2026-01-01&date=2026-01-02"])("rejects invalid availability date %s before DB work", async date => {
    const r = await request(app).get(`/doctors/${id}/availability?date=${date}`);
    expect(r.status).toBe(400);
    expect(h.availability).not.toHaveBeenCalled();
  });

  it("accepts valid dates and rejects malformed doctor identifiers", async () => {
    expect((await request(app).get(`/doctors/${id}/availability?date=2028-02-29`)).status).toBe(200);
    expect(h.availability).toHaveBeenCalledWith(id, "2028-02-29");
    h.availability.mockClear();
    expect((await request(app).get("/doctors/invalid/availability?date=2028-02-29")).status).toBe(400);
    expect(h.availability).not.toHaveBeenCalled();
  });
});

describe("reject abusive bodies safely before parsing", () => {
  const fullApp = createApp();
  it("returns a safe 400 for malformed JSON and counts it toward the IP limit", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (let i = 0; i < 2; i++) {
        const r = await request(fullApp).post("/api/auth/login").set("X-Forwarded-For", "198.51.100.170")
          .set("Content-Type", "application/json").send('{"password":"SYNTHETIC_PRIVATE_VALUE",');
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body)).not.toContain("SYNTHETIC_PRIVATE_VALUE");
      }
      const blocked = await request(fullApp).post("/api/auth/login").set("X-Forwarded-For", "198.51.100.170")
        .set("Content-Type", "application/json").send("invalid JSON");
      expect(blocked.status).toBe(429);
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("returns 413 for an oversized request without logging the supplied body", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await request(fullApp).post("/api/auth/login").set("X-Forwarded-For", "198.51.100.171")
        .send({ password: "x".repeat(2 * 1024 * 1024) });
      expect(r.status).toBe(413);
      expect(r.body).not.toHaveProperty("body");
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
