import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rows: any[] = [];
  const match = (r: any, w: any) =>
    (!w.id || r.id === w.id) && (!w.userId || r.userId === w.userId) && (!w.tokenHash || r.tokenHash === w.tokenHash) &&
    (w.revoked === undefined || r.revoked === w.revoked) && (!w.expiresAt?.gt || r.expiresAt > w.expiresAt.gt);
  const db: any = {
    refreshToken: {
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
      create: vi.fn(async ({ data }: any) => { rows.push({ id: "rt" + rows.length, revoked: false, ...data }); return {}; }),
    },
    user: { findUnique: vi.fn(async () => ({ id: "u", role: "PATIENT", isActive: true, patient: { id: "p" }, doctor: null })) },
  };
  return { db, rows };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));

import jwt from "jsonwebtoken";
import { env } from "../src/config/env";
import { signRefreshToken, verifyRefreshToken } from "../src/utils/jwt";
import { hashToken, issueTokens, markRefreshRotating, revokeAllOnRefreshReuse, sessionTooOld, MAX_SESSION_AGE_MS, REFRESH_REUSE_GRACE_MS } from "../src/lib/tokens";

beforeEach(() => { h.rows.length = 0; vi.clearAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("refresh session guards", () => {
  it("rotation keeps the original session start", async () => {
    const started = Date.now() - 5 * 24 * 3600 * 1000;
    const { refreshToken } = await issueTokens("u", "PATIENT" as any, started);
    expect(verifyRefreshToken(refreshToken).sst).toBe(Math.floor(started / 1000));
  });

  it("rejects sessions older than 30 days; legacy tokens without sst are not logged out", () => {
    const now = Date.now();
    expect(sessionTooOld({ sub: "u", sst: Math.floor((now - MAX_SESSION_AGE_MS - 60_000) / 1000) }, now)).toBe(true);
    expect(sessionTooOld({ sub: "u", sst: Math.floor((now - 3600_000) / 1000) }, now)).toBe(false);
    expect(sessionTooOld(verifyRefreshToken(jwt.sign({ sub: "u" }, env.jwtRefreshSecret, { algorithm: "HS256" })), now)).toBe(false);
  });

  it("a replayed rotated token revokes every session of the account", async () => {
    const token = signRefreshToken({ sub: "u" });
    h.rows.push({ id: "old", userId: "u", tokenHash: hashToken(token), revoked: true, expiresAt: new Date(Date.now() + 1e9) },
      { id: "live", userId: "u", tokenHash: "x", revoked: false, expiresAt: new Date(Date.now() + 1e9) },
      { id: "other", userId: "someone", tokenHash: "y", revoked: false, expiresAt: new Date(Date.now() + 1e9) });
    expect(await revokeAllOnRefreshReuse("u", hashToken(token))).toBe(true);
    expect(h.rows.map((r) => r.revoked)).toEqual([true, true, false]);
  });

  it("two tabs refreshing together are a normal race, not theft", async () => {
    const token = signRefreshToken({ sub: "u" });
    const hash = hashToken(token);
    h.rows.push({ id: "old", userId: "u", tokenHash: hash, revoked: true, expiresAt: new Date(Date.now() + 1e9) },
      { id: "live", userId: "u", tokenHash: "x", revoked: false, expiresAt: new Date(Date.now() + 1e9) });
    const now = Date.now();
    markRefreshRotating(hash, now);
    expect(await revokeAllOnRefreshReuse("u", hash, now + 1000)).toBe(false);
    expect(h.rows[1].revoked).toBe(false);
    expect(await revokeAllOnRefreshReuse("u", hash, now + REFRESH_REUSE_GRACE_MS + 1000)).toBe(true);
  });

  it("an unknown token changes nothing", async () => {
    h.rows.push({ id: "live", userId: "u", tokenHash: "x", revoked: false, expiresAt: new Date(Date.now() + 1e9) });
    expect(await revokeAllOnRefreshReuse("u", "never-issued")).toBe(false);
    expect(h.rows[0].revoked).toBe(false);
  });
});
