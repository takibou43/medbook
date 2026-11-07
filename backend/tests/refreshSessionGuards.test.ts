import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// قاعدة بيانات في الذاكرة تحاكي جدول refresh_tokens بما يكفي لمسار التجديد والخروج كاملًا.
const h = vi.hoisted(() => {
  const rows: any[] = [];
  const cmp = (v: any, c: any) => c === undefined || (c && typeof c === "object" && !(c instanceof Date)
    ? (c.gt === undefined || v > c.gt) && (c.lt === undefined || v < c.lt) : v === c);
  const match = (r: any, w: any) => Object.entries(w).every(([k, c]) => cmp(r[k], c));
  const db: any = {
    refreshToken: {
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
      create: vi.fn(async ({ data }: any) => { rows.push({ id: "rt" + rows.length, revoked: false, createdAt: new Date(), ...data }); return {}; }),
    },
    user: { findUnique: vi.fn(async () => ({ id: "u", role: "DOCTOR", isActive: true, email: "d@x.dz", patient: null, doctor: { id: "d", verificationStatus: "VERIFIED" } })) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return { db, rows };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
// التعدادات حرفية حتى يعمل الاختبار أيضًا حيث لم يُولَّد عميل Prisma (هي نفس قيم المخطط).
vi.mock("@prisma/client", async (orig) => ({
  ...(await orig<object>()),
  Role: { PATIENT: "PATIENT", DOCTOR: "DOCTOR", ADMIN: "ADMIN", ASSISTANT: "ASSISTANT", CLINIC_OWNER: "CLINIC_OWNER" },
}));

import jwt from "jsonwebtoken";
import { env } from "../src/config/env";
import { verifyRefreshToken } from "../src/utils/jwt";
import { hashToken, issueTokens, revokeAllOnRefreshReuse, sessionTooOld, MAX_SESSION_AGE_MS, REFRESH_REUSE_GRACE_MS } from "../src/lib/tokens";
import { refresh } from "../src/modules/auth/auth.service";
import { revokeSession } from "../src/lib/logoutSession";

const T0 = new Date("2026-11-07T10:00:00Z");
const live = () => h.rows.filter((r) => !r.revoked && r.expiresAt > new Date());
beforeEach(() => { h.rows.length = 0; vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); });

describe("refresh session guards", () => {
  it("rotation issues a new token, revokes the old one and keeps the original session start", async () => {
    const { refreshToken } = await issueTokens("u", "DOCTOR" as any);
    vi.setSystemTime(new Date(T0.getTime() + 5 * 24 * 3600_000));
    const next = await refresh(refreshToken);
    expect(verifyRefreshToken(next.refreshToken).sst).toBe(Math.floor(T0.getTime() / 1000));
    expect(live()).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ revoked: true, expiresAt: new Date(T0.getTime() + 5 * 24 * 3600_000) });
  });

  it("a session older than 30 days must log in again", async () => {
    const { refreshToken } = await issueTokens("u", "DOCTOR" as any, T0.getTime() - MAX_SESSION_AGE_MS - 60_000);
    await expect(refresh(refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect(live()).toHaveLength(1); // لا يُبطل شيئًا آخر
  });

  it("tokens issued before this release (no sst) keep working and start their 30 days now", async () => {
    const legacy = jwt.sign({ sub: "u" }, env.jwtRefreshSecret, { algorithm: "HS256", expiresIn: "7d", jwtid: "legacy" });
    h.rows.push({ id: "legacy", userId: "u", tokenHash: hashToken(legacy), revoked: false, expiresAt: new Date(T0.getTime() + 6 * 24 * 3600_000), createdAt: T0 });
    expect(sessionTooOld(verifyRefreshToken(legacy))).toBe(false);
    const next = await refresh(legacy);
    expect(verifyRefreshToken(next.refreshToken).sst).toBe(Math.floor(T0.getTime() / 1000));
  });

  it("two tabs refreshing with the same token: one wins, the other gets 401, nobody is logged out", async () => {
    const { refreshToken } = await issueTokens("u", "DOCTOR" as any);
    const results = await Promise.allSettled([refresh(refreshToken), refresh(refreshToken)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    vi.setSystemTime(new Date(T0.getTime() + 30_000)); // تبويب متأخر خلال الدقيقة
    await expect(refresh(refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect(live()).toHaveLength(1);
  });

  it("replaying a rotated token after the grace minute revokes every session of the account", async () => {
    const { refreshToken: stolen } = await issueTokens("u", "DOCTOR" as any);
    await issueTokens("u", "DOCTOR" as any); // جهاز آخر للحساب نفسه
    h.rows.push({ id: "other-user", userId: "x", tokenHash: "y", revoked: false, expiresAt: new Date(T0.getTime() + 1e9), createdAt: T0 });
    await refresh(stolen);
    vi.setSystemTime(new Date(T0.getTime() + REFRESH_REUSE_GRACE_MS + 60_000));
    await expect(refresh(stolen)).rejects.toMatchObject({ statusCode: 401 });
    expect(live().map((r) => r.userId)).toEqual(["x"]);
    expect(console.warn).toHaveBeenCalledWith("[auth] refresh token reuse detected: all sessions of the account were revoked"); // بلا معرّف ولا بريد
  });

  it("a cookie left after logout is rejected without logging out other devices", async () => {
    const { refreshToken } = await issueTokens("u", "DOCTOR" as any);
    await issueTokens("u", "DOCTOR" as any);
    await revokeSession(refreshToken);
    vi.setSystemTime(new Date(T0.getTime() + 3600_000));
    await expect(refresh(refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect(live()).toHaveLength(1);
  });

  it("tokens revoked before this release are never treated as theft", async () => {
    h.rows.push({ id: "old", userId: "u", tokenHash: "h", revoked: true, expiresAt: new Date(T0.getTime() + 1e9), createdAt: T0 },
      { id: "cur", userId: "u", tokenHash: "c", revoked: false, expiresAt: new Date(T0.getTime() + 1e9), createdAt: T0 });
    expect(await revokeAllOnRefreshReuse("u", "h")).toBe(false);
    expect(await revokeAllOnRefreshReuse("u", "never-issued")).toBe(false);
    expect(live()).toHaveLength(1);
  });
});
