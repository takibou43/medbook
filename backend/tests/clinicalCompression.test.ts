import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { clinicalCompression } from "../src/middleware/clinicalCompression";

const app = express();
app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use(clinicalCompression);
const payload = { data: Array.from({ length: 80 }, (_, id) => ({ id, status: "CONFIRMED", startTime: "08:00" })) };
app.get(["/api/appointments/queue", "/api/assistant/queues", "/api/auth/me", "/api/doctor/assistants/invites"], (_req, res) => res.json(payload));
describe("clinical response compression", () => {
  it("compresses large lists without changing their content or no-store protection", async () => {
    const res = await request(app).get("/api/appointments/queue").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual(payload);
  });
  it("keeps compatibility with clients that do not support compression", async () => {
    const res = await request(app).get("/api/assistant/queues").set("Accept-Encoding", "identity");
    expect(res.headers["content-encoding"]).toBeUndefined(); expect(res.body).toEqual(payload);
  });
  it("never compresses credential or invitation responses", async () => {
    for (const path of ["/api/auth/me", "/api/doctor/assistants/invites"]) {
      const res = await request(app).get(path).set("Accept-Encoding", "gzip");
      expect(res.headers["content-encoding"]).toBeUndefined();
    }
  });
});
