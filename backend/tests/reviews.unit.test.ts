/**
 * المنطق الأساسي لتقييم الطبيب (دوال نقية، بلا قاعدة بيانات): أهلية التقييم، التعليق الاختياري،
 * التقريب، توزيع النجوم، اختصار اللقب، ومخطط التحقق في المسار.
 */
import { describe, it, expect } from "vitest";
import { reviewEligibilityError, normalizeComment, roundAverage, buildDistribution, maskLastName } from "../src/modules/reviews/reviews.service";

const P = "patient-1";

describe("أهلية التقييم", () => {
  it("موعد COMPLETED للمريض نفسه بلا تقييم سابق → مسموح", () => {
    expect(reviewEligibilityError({ patientId: P, status: "COMPLETED" as any, hasReview: false }, P)).toBeNull();
  });
  it.each(["PENDING", "CONFIRMED", "IN_PROGRESS", "LATE", "CANCELLED", "NO_SHOW"])("موعد %s → 400", (status) => {
    expect(reviewEligibilityError({ patientId: P, status: status as any, hasReview: false }, P)).toMatchObject({ status: 400 });
  });
  it("موعد مريض آخر أو حجز ضيف → 403 (قبل فحص الحالة، فلا يكشف حالة موعد غيره)", () => {
    expect(reviewEligibilityError({ patientId: "other", status: "PENDING" as any, hasReview: false }, P)).toMatchObject({ status: 403 });
    expect(reviewEligibilityError({ patientId: null, status: "COMPLETED" as any, hasReview: false }, P)).toMatchObject({ status: 403 });
  });
  it("مُقيَّم من قبل → 409", () => {
    expect(reviewEligibilityError({ patientId: P, status: "COMPLETED" as any, hasReview: true }, P)).toMatchObject({ status: 409 });
  });
});

describe("التعليق الاختياري", () => {
  it.each([undefined, null, "", "   ", "\n\t", 5, {}])("%s → null", (v) => expect(normalizeComment(v)).toBeNull());
  it("يُنقّى من المسافات الطرفية", () => expect(normalizeComment("  شكرًا  ")).toBe("شكرًا"));
});

describe("حساب المتوسط والتوزيع", () => {
  it("التقريب لخانة عشرية واحدة", () => {
    expect(roundAverage(3.75)).toBe(3.8);
    expect(roundAverage(4)).toBe(4);
    expect(roundAverage(13 / 3)).toBe(4.3);
    expect(roundAverage(null)).toBe(0);
    expect(roundAverage(undefined)).toBe(0);
    expect(roundAverage(NaN)).toBe(0);
  });
  it("المتوسط الصحيح لمجموعة تقييمات", () => {
    const ratings = [5, 4, 4, 2, 1, 5];
    expect(roundAverage(ratings.reduce((a, b) => a + b, 0) / ratings.length)).toBe(3.5);
  });
  it("التوزيع يغطي 1..5 دائمًا ويتجاهل القيم الشاذة", () => {
    expect(buildDistribution([{ rating: 5, count: 3 }, { rating: 2, count: 1 }, { rating: 9, count: 4 }])).toEqual({ "1": 0, "2": 1, "3": 0, "4": 0, "5": 3 });
    expect(buildDistribution([])).toEqual({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });
  });
});

describe("خصوصية اسم المريض", () => {
  it("اللقب يُختصر لحرفه الأول", () => {
    expect(maskLastName("بن يوسف")).toBe("ب.");
    expect(maskLastName("  حداد")).toBe("ح.");
    expect(maskLastName("")).toBe("");
    expect(maskLastName(null)).toBe("");
  });
});
