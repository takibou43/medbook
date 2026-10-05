import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const h = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma: { user: { findUnique: h.user } } }));
vi.mock("../src/lib/actingDoctor", () => ({ resolveActingDoctorId: async () => "doctor-a" }));
vi.mock("../src/modules/assistants/assistantBoard.service", () => ({ assignedDoctors: async () => [{ id: "doctor-a" }] }));
import liveRoutes from "../src/modules/live/live.routes";
import { signAccessToken } from "../src/utils/jwt";
import { liveUpdates } from "../src/lib/liveUpdates";
const app = express();
app.use("/api/live", liveRoutes);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.statusCode ?? 500).json({ message: err.message }));
beforeEach(() => { h.user.mockReset(); h.user.mockResolvedValue({ id: "staff", role: "DOCTOR", isActive: true }); });
const token = () => signAccessToken({ sub: "staff", role: "DOCTOR" });
describe("live changes authorization and reconnect", () => {
  it("requires authentication and a staff role", async () => {
    expect((await request(app).get("/api/live/changes")).status).toBe(401);
    h.user.mockResolvedValue({ id: "p", role: "PATIENT", isActive: true });
    expect((await request(app).get("/api/live/changes").set("Authorization", "Bearer " + signAccessToken({ sub: "p", role: "PATIENT" }))).status).toBe(403);
  });
  it("rejects a deactivated account on reconnect", async () => {
    h.user.mockResolvedValue({ id: "staff", role: "DOCTOR", isActive: false });
    expect((await request(app).get("/api/live/changes").set("Authorization", "Bearer " + token())).status).toBe(401);
  });
  it("returns only an opaque revision and immediately recovers missed events", async () => {
    const first = await request(app).get("/api/live/changes").set("Authorization", "Bearer " + token());
    expect(first.status).toBe(200); expect(Object.keys(first.body.data)).toEqual(["revision"]);
    liveUpdates.publish();
    const next = await request(app).get("/api/live/changes").query({ since: first.body.data.revision }).set("Authorization", "Bearer " + token());
    expect(next.status).toBe(200); expect(next.body.data.revision).not.toBe(first.body.data.revision);
  });
  it("wakes a waiting request as soon as data changes", async () => {
    const old = liveUpdates.current(["doctor-a"]);
    const waiting = request(app).get("/api/live/changes").query({ since: old }).set("Authorization", "Bearer " + token()).then(res => res);
    await vi.waitFor(() => expect(h.user).toHaveBeenCalled());
    await new Promise<void>(resolve => setImmediate(resolve));
    liveUpdates.publish();
    const res = await waiting; expect(res.body.data.revision).not.toBe(old);
  });
});
