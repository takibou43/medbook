import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("security audit on isolated PostgreSQL", () => {
  let db: PrismaClient, app: any, sign: typeof import("../../src/utils/jwt").signAccessToken;
  let issue: typeof import("../../src/lib/tokens").issueTokens;
  const ids: string[] = [];
  const tag = `audit-${Date.now()}`;
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/medbook_security_test") throw new Error("Isolated security database required");
    process.env.DATABASE_URL = url!;
    db = new PrismaClient({ datasourceUrl: url });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    ({ issueTokens: issue } = await import("../../src/lib/tokens"));
    app = (await import("../../src/app")).createApp();
  });
  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await (await import("../../src/lib/prisma")).prisma.$disconnect();
  });
  async function user(role: "PATIENT" | "ADMIN") {
    const row = await db.user.create({ data: { email: `${tag}-${ids.length}@example.test`, passwordHash: "synthetic-unused", role, ...(role === "PATIENT" ? { patient: { create: { firstName: "Synthetic", lastName: "Audit" } } } : {}) } });
    ids.push(row.id);
    return row;
  }
  it("disabled accounts and deleted accounts cannot reuse a still valid access token", async () => {
    const u = await user("PATIENT"), token = sign({ sub: u.id, role: "PATIENT" });
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer " + token)).status).toBe(200);
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer " + token)).status).toBe(401);
    await db.user.delete({ where: { id: u.id } });
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer " + token)).status).toBe(401);
  });
  it("a previous admin JWT cannot preserve admin access after demotion", async () => {
    const u = await user("ADMIN"), token = sign({ sub: u.id, role: "ADMIN" });
    await db.user.update({ where: { id: u.id }, data: { role: "PATIENT" } });
    expect((await request(app).get("/api/admin/stats").set("Authorization", "Bearer " + token)).status).toBe(403);
  });
  it.each(["/api/auth/refresh", "/api/patient/auth/refresh"])("only one of 20 concurrent refreshes succeeds at %s", async path => {
    const u = await user("PATIENT"), tokens = await issue(u.id, u.role);
    const cookieName = path.includes("patient") ? "medbook_patient_refresh" : "medbook_refresh";
    const responses = await Promise.all(Array.from({ length: 20 }, () => request(app).post(path).set("Cookie", `${cookieName}=${tokens.refreshToken}`)));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => r.status === 401)).toHaveLength(19);
    expect(await db.refreshToken.count({ where: { userId: u.id, revoked: false } })).toBe(1);
  });
});
