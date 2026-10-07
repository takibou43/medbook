import { describe, expect, it } from "vitest";
import { isKeepAwakeWindow } from "../src/lib/awakeWindow";

describe("keep-awake window in Algeria", () => {
  it.each([
    ["2026-10-07T03:59:59Z", false], // 04:59
    ["2026-10-07T04:00:00Z", true],  // 05:00
    ["2026-10-07T16:59:59Z", true],  // 17:59
    ["2026-10-07T17:00:00Z", false], // 18:00
    ["2026-10-07T22:59:59Z", false],
    ["2026-10-08T23:30:00Z", false], // Friday in Algeria
    ["2026-10-09T15:59:59Z", false], // Friday before 17:00
    ["2026-10-09T16:00:00Z", true],
    ["2026-10-09T17:00:00Z", false],
    ["2026-10-10T04:00:00Z", true],  // Saturday normal opening
  ])("%s -> %s", (instant, expected) => {
    expect(isKeepAwakeWindow(new Date(instant))).toBe(expected);
  });
});
