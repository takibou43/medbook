import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import clientErrorsRoutes, { scrubClientText, CLIENT_ERROR_LIMIT } from "../src/modules/clientErrors/clientErrors.routes";
import { errorHandler } from "../src/middleware/errorHandler";
import { env } from "../src/config/env";

const app = express();
app.use(express.json());
app.use("/api/client-errors", clientErrorsRoutes);
app.use(errorHandler);

describe("client error reports", () => {
  it("removes patient data before logging", () => {
    const out = scrubClientText("fail at https://x.dz/status/123e4567-e89b-12d3-a456-426614174000?phone=0551234567 for a@b.dz call 0551 23 45 67", 300)!;
    expect(out).not.toContain("0551");
    expect(out).not.toContain("a@b.dz");
    expect(out).not.toContain("phone=");
    expect(out).not.toContain("123e4567");
  });

  it("logs a scrubbed single line and answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(app).post("/api/client-errors")
      .send({ portal: "patient", kind: "error", message: "boom 0551234567", path: "/status/x?token=abc" });
    expect(res.status).toBe(204);
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("[client-error]");
    expect(logged).not.toContain("0551234567");
    expect(logged).not.toContain("token=abc");
    warn.mockRestore();
  });

  it("rejects unknown fields and foreign origins", async () => {
    const extra = await request(app).post("/api/client-errors").send({ portal: "patient", kind: "error", message: "x", userId: "u" });
    expect(extra.status).toBe(400);
    const foreign = await request(app).post("/api/client-errors").set("Origin", "https://evil.example")
      .send({ portal: "patient", kind: "error", message: "x" });
    expect(foreign.status).toBe(403);
    expect(env.clientUrls).not.toContain("https://evil.example");
  });

  it("caps reports per address", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const local = express();
    local.use(express.json());
    local.use("/e", (await import("../src/modules/clientErrors/clientErrors.routes")).default);
    let last = 0;
    for (let i = 0; i <= CLIENT_ERROR_LIMIT + 1; i += 1) {
      last = (await request(local).post("/e").send({ portal: "doctor", kind: "chunk", message: "m" })).status;
    }
    expect(last).toBe(429);
  });
});
