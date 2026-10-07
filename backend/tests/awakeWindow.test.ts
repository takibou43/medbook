import { describe, expect, it } from "vitest";
import { isKeepAwakeWindow } from "../src/lib/awakeWindow";

describe("keep-awake window in Algeria", () => {
  it.each([
    ["2026-10-07T04:00:00Z", false],
    ["2026-10-07T07:29:59Z", false], // 08:29 Algeria
    ["2026-10-07T07:30:00Z", true],  // 08:30 Algeria
    ["2026-10-07T16:59:59Z", true],
    ["2026-10-07T17:00:00Z", false], // 18:00 Algeria
    ["2026-10-07T22:59:59Z", false],
    ["2026-10-08T23:30:00Z", false], // Midnight rollover
    ["2026-10-09T07:29:59Z", false], // Same opening on Friday
    ["2026-10-09T07:30:00Z", true],
    ["2026-10-09T17:00:00Z", false],
    ["2026-10-10T07:30:00Z", true],
  ])("%s -> %s", (instant, expected) => {
    expect(isKeepAwakeWindow(new Date(instant))).toBe(expected);
  });
});
