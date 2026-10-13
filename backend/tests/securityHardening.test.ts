import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { personName } from "../src/lib/personName";
import { requireTrustedOrigin } from "../src/middleware/originGuard";
import { signAccessToken, verifyAccessToken } from "../src/utils/jwt";
import { env } from "../src/config/env";

describe("personName — يمنع حقن HTML في الأسماء", () => {
  const schema = personName();
  it("يقبل أسماء عربية ولاتينية عادية", () => {
    for (const n of ["محمد", "عبد الرحمن", "Jean-Pierre", "O'Brien", "Amélie", "بن عيسى", "اختبار-1"]) {
      expect(schema.safeParse(n).success).toBe(true);
    }
  });
  it("يرفض وسوم HTML ومحارف الحقن", () => {
    for (const n of ["<img src=x onerror=alert(1)>", "a<b", "x\"y", "x&y", "<script>", "a`b"]) {
      expect(schema.safeParse(n).success).toBe(false);
    }
  });
});

describe("requireTrustedOrigin — حماية CSRF لمسارات الكوكي", () => {
  const run = (origin?: string) => {
    let err: unknown = "none";
    const req: any = { get: (h: string) => (h.toLowerCase() === "origin" ? origin : undefined) };
    requireTrustedOrigin(req, {} as any, (e?: unknown) => { err = e; });
    return err;
  };
  it("يسمح بلا Origin وبـOrigin مدرج", () => {
    expect(run(undefined)).toBeUndefined();
    expect(run(env.clientUrls[0])).toBeUndefined();
  });
  it("يرفض Origin غريبًا", () => {
    expect(run("https://evil.example")).toBeTruthy();
  });
});

describe("JWT — تثبيت الخوارزمية", () => {
  it("يرفض توكنًا موقّعًا بخوارزمية HS512", () => {
    const t = jwt.sign({ sub: "u", role: "PATIENT" }, env.jwtSecret, { algorithm: "HS512" });
    expect(() => verifyAccessToken(t)).toThrow();
  });
  it("يقبل HS256 الصادر عن الخادم", () => {
    expect(verifyAccessToken(signAccessToken({ sub: "u", role: "PATIENT" })).sub).toBe("u");
  });
});
