import { describe, expect, it } from "vitest";
// @ts-expect-error سكربت JavaScript خارج مشروع الخادم
import { planRotation, runBackup, isBranchLimitError, NeonApiError } from "../../scripts/neon-branch-backup.mjs";

const PARENT = "br-prod-1";
const b = (id: string, name: string, created_at: string, extra = {}) => ({ id, name, created_at, parent_id: PARENT, primary: false, default: false, current_state: "ready", ...extra });

/** محاكاة Neon API: حد 10 فروع، ومحاولات إنشاء يمكن إفشالها بأخطاء محددة. */
function fakeNeon(initial: any[], opts: { createFailures?: Array<{ status: number; body: string } | "network">; limit?: number; readyAfter?: number; badCreate?: boolean } = {}) {
  const branches = initial.map((x) => ({ ...x }));
  const deleted: string[] = [];
  const failures = [...(opts.createFailures ?? [])];
  let polls = 0;
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  const fetchImpl = async (url: string, init: any) => {
    const path = url.replace(/^.*\/projects\/[^/]+/, "");
    if (init.method === "GET" && path === "/branches") return json(200, { branches });
    if (init.method === "POST" && path === "/branches") {
      const f = failures.shift();
      if (f === "network") throw new TypeError("fetch failed");
      if (f) return json(f.status, f.body);
      if (branches.length >= (opts.limit ?? 10)) return json(422, { code: "BRANCHES_LIMIT_EXCEEDED", message: "branches limit exceeded" });
      const { name, parent_id } = JSON.parse(init.body).branch;
      const nb = { id: `br-new-${branches.length}`, name, parent_id, created_at: "2026-11-21T02:23:00Z", primary: false, default: false, current_state: "init" };
      branches.push(nb);
      return json(201, { branch: opts.badCreate ? { ...nb, id: "oops" } : nb });
    }
    const m = path.match(/^\/branches\/(.+)$/);
    if (m && init.method === "GET") {
      const br = branches.find((x) => x.id === m[1]);
      polls += 1;
      if (br && polls > (opts.readyAfter ?? 1)) br.current_state = "ready";
      return json(br ? 200 : 404, { branch: br });
    }
    if (m && init.method === "DELETE") {
      const i = branches.findIndex((x) => x.id === m[1]);
      if (i >= 0) { deleted.push(m[1]); branches.splice(i, 1); }
      return json(200, {});
    }
    return json(404, {});
  };
  return { branches, deleted, fetchImpl };
}

const env = { NEON_API_KEY: "fake", NEON_PROJECT_ID: "p", NEON_PARENT_BRANCH_ID: PARENT, KEEP: "2" };
const run = (neon: ReturnType<typeof fakeNeon>, extra = {}) =>
  runBackup({ env: { ...env, ...extra }, fetchImpl: neon.fetchImpl, sleep: async () => {}, log: () => {}, now: () => new Date("2026-11-21T02:23:00Z") });

const prod = b(PARENT, "production", "2026-09-01", { primary: true, default: true, parent_id: undefined });
const manual = (n: number) => b(`br-manual-${n}`, `backup-before-x-${n}`, `2026-10-0${n}`);
const restore = b("br-restore", "restore-test-20261107", "2026-11-07");
const a1 = b("br-a1", "auto-backup-202611070223", "2026-11-07");
const a2 = b("br-a2", "auto-backup-202611140223", "2026-11-14");

describe("planRotation", () => {
  it("KEEP=1 with a verified new backup deletes every older automatic backup", () => {
    expect(planRotation([prod, a1, a2, b("br-n", "auto-backup-new", "2026-11-21")], { keep: 1, protectIds: ["br-n"] })).toEqual(["br-a2", "br-a1"]);
  });
  it("KEEP=2 keeps the new backup plus the newest older one; never touches manual or restore branches", () => {
    expect(planRotation([prod, manual(1), restore, a1, a2, b("br-n", "auto-backup-new", "2026-11-21")], { keep: 2, protectIds: ["br-n"] })).toEqual(["br-a1"]);
  });
});

describe("runBackup full flow (simulated Neon API)", () => {
  it("missing key reports not-configured, not success, and calls nothing", async () => {
    let called = false;
    const r = await runBackup({ env: { ...env, NEON_API_KEY: "" }, fetchImpl: async () => { called = true; return {} as any; } });
    expect(r.status).toBe("not-configured");
    expect(called).toBe(false);
  });

  it("normal week: creates, waits until ready, then keeps the newest two", async () => {
    const neon = fakeNeon([prod, manual(1), restore, a1, a2], { readyAfter: 2 });
    const r = await run(neon);
    expect(r.status).toBe("ok");
    expect(neon.deleted).toEqual(["br-a1"]);
    expect(neon.branches.map((x) => x.id)).toEqual(expect.arrayContaining([PARENT, "br-manual-1", "br-restore", "br-a2", r.id]));
  });

  it("branch limit: rotates only the oldest automatic backup, then succeeds", async () => {
    const neon = fakeNeon([prod, ...[1, 2, 3, 4, 5, 6].map(manual), restore, a1, a2]);
    const r = await run(neon);
    expect(r.status).toBe("ok");
    expect(neon.deleted).toEqual(["br-a1"]);
    expect(neon.branches.some((x) => x.id === "br-a2")).toBe(true);
  });

  it("branch limit and the second attempt fails: one healthy automatic backup remains, nothing else deleted", async () => {
    const neon = fakeNeon([prod, ...[1, 2, 3, 4, 5, 6].map(manual), restore, a1, a2], {
      createFailures: [{ status: 422, body: JSON.stringify({ code: "BRANCHES_LIMIT_EXCEEDED", message: "branches limit exceeded" }) }, { status: 503, body: "unavailable" }],
    });
    await expect(run(neon)).rejects.toThrow();
    expect(neon.deleted).toEqual(["br-a1"]);
    expect(neon.branches.map((x) => x.id)).toContain("br-a2");
  });

  it("branch limit with fewer than two automatic backups: deletes nothing", async () => {
    const neon = fakeNeon([prod, ...[1, 2, 3, 4, 5, 6, 7].map(manual), restore, a2]);
    await expect(run(neon)).rejects.toThrow(/حرّر خانة/);
    expect(neon.deleted).toEqual([]);
  });

  for (const failure of [
    "network" as const,
    { status: 401, body: "unauthorized" }, { status: 403, body: "forbidden" }, { status: 429, body: "rate limited" },
    { status: 500, body: "boom" }, { status: 503, body: "branches limit exceeded" }, { status: 422, body: JSON.stringify({ code: "INVALID", message: "bad parent" }) },
  ]) {
    it(`create error ${typeof failure === "string" ? failure : failure.status} deletes nothing`, async () => {
      const neon = fakeNeon([prod, restore, a1, a2], { createFailures: [failure] });
      await expect(run(neon)).rejects.toThrow();
      expect(neon.deleted).toEqual([]);
    });
  }

  it("an unexpected create response or a copy that never becomes ready: retention is not applied", async () => {
    const bad = fakeNeon([prod, a1, a2], { badCreate: true });
    await expect(run(bad)).rejects.toThrow(/معرّف/);
    expect(bad.deleted).toEqual([]);
    const slow = fakeNeon([prod, a1, a2], { readyAfter: 1000 });
    await expect(run(slow)).rejects.toThrow(/جاهزة/);
    expect(slow.deleted).toEqual([]);
  });

  it("recognises only the real branch-limit error", () => {
    expect(isBranchLimitError(new NeonApiError("POST", 422, JSON.stringify({ message: "branches limit exceeded" })))).toBe(true);
    expect(isBranchLimitError(new NeonApiError("POST", 422, "branches limit exceeded"))).toBe(true);
    expect(isBranchLimitError(new NeonApiError("POST", 429, "branches limit exceeded"))).toBe(false);
    expect(isBranchLimitError(new TypeError("fetch failed"))).toBe(false);
  });
});
