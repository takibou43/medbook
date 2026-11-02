import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertBoundedInput } from "../src/lib/inputShape";

describe("bounded validation", () => {
  it("rejects oversized collections before validation and accepts a valid collection", () => {
    const schema = z.object({ values: z.array(z.string()).max(10) });
    expect(() => assertBoundedInput({ values: Array(1001).fill(0) })).toThrow();
    const valid = { values: ["one", "two"] };
    expect(() => assertBoundedInput(valid)).not.toThrow();
    expect(schema.parse(valid)).toEqual(valid);
  });

  it("does not accumulate an issue per item for an oversized constrained array", () => {
    const result = z.array(z.string()).max(10).safeParse(Array(10000).fill(0));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeLessThan(10);
  });
});
