/**
 * In production the doctor portal (Vercel) calls the API (Render) cross-site, so the
 * refresh cookie is SameSite=None; Secure. A clearing Set-Cookie without those
 * attributes defaults to SameSite=Lax and browsers drop it on a cross-site response,
 * leaving the cookie in the browser after logout. Synthetic session only.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "production"; });
vi.mock("../src/lib/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/auth/auth.service", async (orig) => ({
  ...(await orig<object>()),
  logout: vi.fn(async () => undefined),
}));

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import authRoutes from "../src/modules/auth/auth.routes";
import { errorHandler } from "../src/middleware/errorHandler";

describe("doctor portal logout clears the cross-site refresh cookie", () => {
  it("sends the clearing cookie with the same SameSite=None; Secure; path attributes", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/auth", authRoutes);
    app.use(errorHandler);
    const res = await request(app).post("/api/auth/logout").set("Cookie", "medbook_refresh=synthetic").send({});
    expect(res.status).toBe(200);
    const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find(c => c.startsWith("medbook_refresh="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
  });
});
