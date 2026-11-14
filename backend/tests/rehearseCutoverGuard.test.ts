import { describe, expect, it } from "vitest";
// @ts-expect-error سكربت JavaScript
import { validateRehearsalUrl } from "../scripts/rehearse-cutover-existing-db.mjs";

describe("cutover rehearsal refuses production", () => {
  it("rejects the production Neon endpoint in any form", () => {
    for (const host of ["ep-flat-scene-a58qzr72.us-east-2.aws.neon.tech", "ep-flat-scene-a58qzr72-pooler.us-east-2.aws.neon.tech", "EP-FLAT-SCENE-A58QZR72.us-east-2.aws.neon.tech"]) {
      expect(() => validateRehearsalUrl(`postgresql://u:p@${host}/neondb?sslmode=require`)).toThrow(/production/);
    }
  });
  it("accepts an isolated branch endpoint or a local database", () => {
    expect(validateRehearsalUrl("postgresql://u:p@ep-icy-lake-a5x3w9py.us-east-2.aws.neon.tech/neondb?sslmode=require")).toContain("ep-icy-lake");
    expect(validateRehearsalUrl("postgresql://u:p@127.0.0.1:5433/medbook_cutover_test")).toContain("127.0.0.1");
  });
  it("rejects empty or non-PostgreSQL URLs", () => {
    expect(() => validateRehearsalUrl("")).toThrow();
    expect(() => validateRehearsalUrl("mysql://u:p@h/db")).toThrow();
  });
});
