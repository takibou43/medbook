import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { liveInvalidation, affectedDoctors } from "../src/middleware/liveInvalidation";
import { liveUpdates } from "../src/lib/liveUpdates";
const app = express();
app.use("/api", liveInvalidation);
app.post("/api/booking/success", (_req, res) => res.status(201).json({ privatePatient: "must-not-be-in-signal" }));
app.post("/api/booking/failure", (_req, res) => res.sendStatus(409));
app.post("/api/auth/refresh", (_req, res) => res.json({ token: "test" }));
app.get("/api/appointments/queue", (_req, res) => res.json({ data: [] }));
describe("post-commit invalidation", () => {
  it("uses doctor IDs from appointment responses, never patient or user IDs", () => {
    expect(affectedDoctors({ data: { appointment: { doctorId: "doctor-a", patient: { id: "private" } } } })).toEqual(["doctor-a"]);
    expect(affectedDoctors({ data: { id: "patient" } })).toEqual([]);
    expect(affectedDoctors({ data: [{ doctorId: "a" }, { doctorId: "b" }] })).toEqual(["a", "b"]);
  });
  it("publishes on successful booking only, with no response data", async () => {
    const seen: string[] = [];
    const close = liveUpdates.subscribe(value => seen.push(value));
    const initial = liveUpdates.current();
    await request(app).post("/api/booking/failure");
    await request(app).post("/api/auth/refresh");
    await request(app).get("/api/appointments/queue");
    expect(liveUpdates.current()).toBe(initial); expect(seen).toHaveLength(0);
    await request(app).post("/api/booking/success");
    expect(seen).toEqual([liveUpdates.current()]);
    expect(seen[0]).not.toContain("must-not-be-in-signal"); close();
  });
});
