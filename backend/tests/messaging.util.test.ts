import { describe, it, expect } from "vitest";
import { sanitizeMessageContent, previewOf, MAX_MESSAGE_LENGTH } from "../src/modules/messaging/messaging.util";
import { resolveSeriesRange } from "../src/modules/admin/admin.service";

describe("sanitizeMessageContent", () => {
  it("يقصّ الفراغات ويقبل النص العادي", () => {
    expect(sanitizeMessageContent("  مرحباً دكتور  ")).toBe("مرحباً دكتور");
  });
  it("يرفض الفارغة وذات الفراغات فقط وغير النصية", () => {
    expect(() => sanitizeMessageContent("")).toThrow();
    expect(() => sanitizeMessageContent("   \n\t ")).toThrow();
    expect(() => sanitizeMessageContent(undefined)).toThrow();
    expect(() => sanitizeMessageContent(123)).toThrow();
  });
  it("يرفض ما يتجاوز الحد الأقصى ويقبل الحد بالضبط", () => {
    expect(() => sanitizeMessageContent("a".repeat(MAX_MESSAGE_LENGTH + 1))).toThrow();
    expect(sanitizeMessageContent("a".repeat(MAX_MESSAGE_LENGTH))).toHaveLength(MAX_MESSAGE_LENGTH);
  });
  it("يزيل محارف التحكم واتجاه النص المخفي ويبقي الأسطر", () => {
    expect(sanitizeMessageContent("a\u0000b‮c\nd")).toBe("abc\nd");
  });
  it("لا يُرمّز HTML (التهريب مسؤولية العرض) لكن يبقيه نصًا خامًا", () => {
    expect(sanitizeMessageContent("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
  it("previewOf يقصّ الطويل", () => {
    expect(previewOf("x".repeat(200)).length).toBeLessThanOrEqual(81);
  });
});

describe("resolveSeriesRange", () => {
  const today = new Date(Date.UTC(2026, 8, 21)); // 21 سبتمبر 2026
  const days = (r: { from: Date; to: Date }) => Math.round((r.to.getTime() - r.from.getTime()) / 86400000) + 1;
  it("7d و30d", () => {
    expect(days(resolveSeriesRange("7d", today))).toBe(7);
    expect(days(resolveSeriesRange("30d", today))).toBe(30);
  });
  it("هذا الشهر: من 1 إلى اليوم", () => {
    const r = resolveSeriesRange("this_month", today);
    expect(r.from.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(r.to.toISOString().slice(0, 10)).toBe("2026-09-21");
  });
  it("الشهر الماضي كاملًا (أغسطس = 31 يومًا)", () => {
    const r = resolveSeriesRange("last_month", today);
    expect(r.from.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(r.to.toISOString().slice(0, 10)).toBe("2026-08-31");
  });
  it("الشهر الماضي عبر حدود السنة", () => {
    const r = resolveSeriesRange("last_month", new Date(Date.UTC(2026, 0, 5)));
    expect(r.from.toISOString().slice(0, 10)).toBe("2025-12-01");
    expect(r.to.toISOString().slice(0, 10)).toBe("2025-12-31");
  });
});
