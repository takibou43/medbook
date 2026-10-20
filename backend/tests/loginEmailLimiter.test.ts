/**
 * حدّ محاولات الدخول الفاشلة لكل بريد: يُعدّ الفشل فقط، ولكل بريد سلّته الخاصة مهما تغيّر عنوان IP.
 * لا يحتاج قاعدة بيانات: تطبيق Express مصغّر يرد 401 لكلمة المرور الخاطئة و200 للصحيحة.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

describe("loginEmailLimiter", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
    process.env.JWT_SECRET ??= "test-access-secret";
    process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
    const { loginEmailLimiter } = await import("../src/middleware/rateLimiter");
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post("/login", loginEmailLimiter, (req, res) => {
      if (req.body.password === "correct") return res.json({ ok: true });
      return res.status(401).json({ ok: false });
    });
  });

  const attempt = (email: string, password: string, ip: string) =>
    request(app).post("/login").set("X-Forwarded-For", ip).send({ email, password });

  it("يقفل البريد بعد 10 محاولات فاشلة حتى لو جاءت كل محاولة من IP مختلف", async () => {
    for (let i = 0; i < 10; i++) expect((await attempt("victim@example.com", "wrong", `203.0.113.${i + 1}`)).status).toBe(401);
    expect((await attempt("victim@example.com", "wrong", "203.0.113.200")).status).toBe(429);
    // نفس البريد بحروف مختلفة ومسافات = نفس السلّة.
    expect((await attempt("  VICTIM@example.com ", "correct", "203.0.113.201")).status).toBe(429);
  });

  it("لا يتأثر بريد آخر، ولا تُحسب المحاولات الناجحة", async () => {
    for (let i = 0; i < 15; i++) expect((await attempt("doctor@example.com", "correct", "198.51.100.9")).status).toBe(200);
    expect((await attempt("doctor@example.com", "wrong", "198.51.100.9")).status).toBe(401);
  });
});
