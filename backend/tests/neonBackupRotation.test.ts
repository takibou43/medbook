import { describe, expect, it } from "vitest";
// @ts-expect-error سكربت JavaScript خارج مشروع الخادم
import { planRotation } from "../../scripts/neon-branch-backup.mjs";

const b = (id: string, name: string, created_at: string, extra = {}) => ({ id, name, created_at, primary: false, default: false, ...extra });
const branches = [
  b("prod", "production", "2026-09-01", { primary: true, default: true }),
  b("manual", "backup-before-clinics-2026-10-01", "2026-10-01"),
  b("a1", "auto-backup-202611070223", "2026-11-07"),
  b("a2", "auto-backup-202611140223", "2026-11-14"),
  b("a3", "auto-backup-202611210223", "2026-11-21"),
];

describe("Neon backup retention", () => {
  it("keeps the newest automatic backups and never touches other branches", () => {
    expect(planRotation(branches, { keep: 2 })).toEqual(["a1"]);
    expect(planRotation(branches, { keep: 1 })).toEqual(["a2", "a1"]);
  });
  it("never deletes the backup that was just created", () => {
    expect(planRotation(branches, { keep: 2, protectIds: ["a3"] })).toEqual(["a1"]);
    expect(planRotation(branches, { keep: 1, protectIds: ["a3"] })).toEqual(["a1"]);
  });
  it("does nothing when there are no automatic backups", () => {
    expect(planRotation(branches.slice(0, 2), { keep: 1 })).toEqual([]);
  });
});
