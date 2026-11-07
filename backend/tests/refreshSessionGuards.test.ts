import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// جدول refresh_tokens في الذاكرة يقيّم شروط where فعليًا (OR / lt / gt / مساواة)،
// فتختبر الحالات النتيجة السلوكية لا شكل الاستعلام.
const h = vi.hoisted(() => {
  const rows: any[] = [];
  const cond = (v: any, c: any): boolean => {
    if (c && typeof c === "object" && !(c instanceof Date)) {
      return (c.lt === undefined || v < c.lt) && (c.gt === undefined || v > c.gt) && (c.lte === undefined || v <= c.lte);
    }
    return v instanceof Date && c instanceof Date ? v.getTime() === c.getTime() : v === c;
  };
  const match = (r: any, w: any): boolean => Object.entries(w).every(([k, c]) =>
    k === "OR" ? (c as any[]).some((sub) => match(r, sub)) : cond(r[k], c));
  const db: any = {
    refreshToken: {
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
      deleteMany: vi.fn(async ({ where }: any) => { let n = 0; for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i], where)) { rows.splice(i, 1); n += 1; } return { count: n }; }),
      create: vi.fn(async ({ data }: any) => { rows.push({ id: "rt" + Math.random().toString(36).slice(2), revoked: false, createdAt: new Date(), ...data }); return {}; }),
    },
    // حساب واحد له ملفا طبيب ومريض: يغطي مساري التجديد في الموقعين.
    user: { findUnique: vi.fn(async () => ({ id: "u", role: "DOCTOR", isActive: true, email: "d@x.dz", firstName: "x", patient: { id: "p" }, doctor: { id: "d", verificationStatus: "VERIFIED" } })) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return { db, rows };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("../src/modules/patientBlocks/patientBlocks.service", () => ({ isPatientBlocked: vi.fn(async () => false) }));
// تعدادات المخطط تُقرأ من schema.prisma نفسه، فيعمل الاختبار حيث لم يُولَّد عميل Prisma بالقيم نفسها.
vi.mock("@prisma/client", async (orig) => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
  const enums: Record<string, Record<string, string>> = {};
  for (const [, name, body] of schema.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
    enums[name] = Object.fromEntries(body.split("\n").map((l) => l.trim().split(/\s/)[0]).filter((v) => /^[A-Z_]+$/.test(v)).map((v) => [v, v]));
  }
  return { ...(await orig<object>()), ...enums };
});

import jwt from "jsonwebtoken";
import { env } from "../src/config/env";
import { verifyRefreshToken } from "../src/utils/jwt";

const DAY = 24 * 3600_000;
const T0 = new Date("2026-11-07T10:00:00Z");
const at = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));
const live = () => h.rows.filter((r) => !r.revoked && r.expiresAt > new Date());

async function load() {
  vi.resetModules(); // يحاكي إعادة تشغيل الخادم: لا حالة في الذاكرة بين التحميلين
  const tokens = await import("../src/lib/tokens");
  const doctor = await import("../src/modules/auth/auth.service");
  const patient = await import("../src/modules/patientAuth/patientAuth.service");
  const logout = await import("../src/lib/logoutSession");
  return { ...tokens, doctorRefresh: doctor.refresh, patientRefresh: patient.refreshPatientSession, revokeSession: logout.revokeSession };
}

beforeEach(() => { h.rows.length = 0; vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); });

for (const portal of ["doctor", "patient"] as const) {
  const refreshOf = (m: Awaited<ReturnType<typeof load>>) => (portal === "doctor" ? m.doctorRefresh : m.patientRefresh);

  describe(`${portal} refresh sessions`, () => {
    it("rotation issues a new token, revokes the old one and keeps the original session start", async () => {
      const m = await load();
      const { refreshToken } = await m.issueTokens("u", "DOCTOR" as any);
      at(5 * DAY);
      const next = await refreshOf(m)(refreshToken);
      expect(verifyRefreshToken(next.refreshToken).sst).toBe(Math.floor(T0.getTime() / 1000));
      expect(live()).toHaveLength(1);
    });

    it("a token issued 5 days ago and rotated now survives the next purge, and its replay revokes all sessions", async () => {
      const m = await load();
      const { refreshToken: old } = await m.issueTokens("u", "DOCTOR" as any);
      at(5 * DAY);
      await refreshOf(m)(old); // دُوّر الآن
      at(5 * DAY + 3 * 3600_000);
      await m.purgeStaleRefreshTokens(); // تنظيف الصيانة التالي
      expect(h.rows.find((r) => r.tokenHash === m.hashToken(old))).toBeDefined();
      await expect(refreshOf(m)(old)).rejects.toMatchObject({ statusCode: 401 });
      expect(live()).toHaveLength(0);
    });

    it("after the 2-day retention the rotated row is purged; a replay is then just rejected", async () => {
      const m = await load();
      const { refreshToken: old } = await m.issueTokens("u", "DOCTOR" as any);
      at(DAY);
      await refreshOf(m)(old);
      at(DAY + 2 * DAY + 60_000);
      await m.purgeStaleRefreshTokens();
      expect(h.rows.find((r) => r.tokenHash === m.hashToken(old))).toBeUndefined();
      await expect(refreshOf(m)(old)).rejects.toMatchObject({ statusCode: 401 });
    });

    it("detection survives a server restart (no in-memory state)", async () => {
      const first = await load();
      const { refreshToken: old } = await first.issueTokens("u", "DOCTOR" as any);
      await refreshOf(first)(old);
      at(10 * 60_000);
      const restarted = await load();
      await expect(refreshOf(restarted)(old)).rejects.toMatchObject({ statusCode: 401 });
      expect(live()).toHaveLength(0);
    });

    it("concurrent refreshes: exactly one wins, a late tab within a minute gets 401, nobody is logged out", async () => {
      const m = await load();
      const { refreshToken } = await m.issueTokens("u", "DOCTOR" as any);
      const results = await Promise.allSettled([refreshOf(m)(refreshToken), refreshOf(m)(refreshToken), refreshOf(m)(refreshToken)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      at(30_000);
      await expect(refreshOf(m)(refreshToken)).rejects.toMatchObject({ statusCode: 401 });
      expect(live()).toHaveLength(1);
    });

    it("logout and password-change revocations are never treated as theft", async () => {
      const m = await load();
      const { refreshToken: loggedOut } = await m.issueTokens("u", "DOCTOR" as any);
      await m.issueTokens("u", "DOCTOR" as any); // جهاز آخر
      await m.revokeSession(loggedOut);
      at(3600_000);
      await m.purgeStaleRefreshTokens();
      await expect(refreshOf(m)(loggedOut)).rejects.toMatchObject({ statusCode: 401 });
      expect(live()).toHaveLength(1);
      // تغيير كلمة المرور يلغي الكل مع إبقاء expiresAt الأصلي
      await h.db.refreshToken.updateMany({ where: { userId: "u", revoked: false }, data: { revoked: true } });
      const { refreshToken: fresh } = await m.issueTokens("u", "DOCTOR" as any);
      await expect(refreshOf(m)(loggedOut)).rejects.toMatchObject({ statusCode: 401 });
      expect(h.rows.find((r) => r.tokenHash === m.hashToken(fresh))?.revoked).toBe(false);
    });

    it("a session older than 30 days must log in again; tokens from before this release (no sst) keep working", async () => {
      const m = await load();
      const { refreshToken: ancient } = await m.issueTokens("u", "DOCTOR" as any, T0.getTime() - m.MAX_SESSION_AGE_MS - 60_000);
      await expect(refreshOf(m)(ancient)).rejects.toMatchObject({ statusCode: 401 });
      const legacy = jwt.sign({ sub: "u" }, env.jwtRefreshSecret, { algorithm: "HS256", expiresIn: "7d", jwtid: "legacy-" + portal });
      h.rows.push({ id: "legacy", userId: "u", tokenHash: m.hashToken(legacy), revoked: false, expiresAt: new Date(T0.getTime() + 6 * DAY), createdAt: T0 });
      const next = await refreshOf(m)(legacy);
      expect(verifyRefreshToken(next.refreshToken).sst).toBe(Math.floor(T0.getTime() / 1000));
    });

    it("rows revoked before this release (future expiresAt) never trigger revoke-all", async () => {
      const m = await load();
      h.rows.push({ id: "old", userId: "u", tokenHash: "h", revoked: true, expiresAt: new Date(T0.getTime() + 4 * DAY), createdAt: T0 },
        { id: "cur", userId: "u", tokenHash: "c", revoked: false, expiresAt: new Date(T0.getTime() + 4 * DAY), createdAt: T0 });
      expect(await m.revokeAllOnRefreshReuse("u", "h")).toBe(false);
      expect(live()).toHaveLength(1);
    });
  });
}
