import { describe, it, expect } from "vitest";
import { AppointmentStatus } from "@prisma/client";
import {
  clinicDoctorTermsSchema, splitAppointment, clinicSharePercent, effectiveAppointmentPrice, financialSnapshot,
  withPublicFee, summarizeFinance, revenueFromGroups,
} from "../src/lib/clinicFinance";
import { clinicInviteSchema } from "../src/modules/clinics/clinics.schema";

const S = AppointmentStatus;
const terms = (over: Partial<{ clinicId: string; appointmentPriceDzd: number | null; doctorSharePercent: number | null }> = {}) =>
  ({ clinicId: "c1", appointmentPriceDzd: 2000, doctorSharePercent: 80, ...over });

describe("حساب الحصص", () => {
  it("المثال المطلوب: 2000 دج ونسبة طبيب 80% = 1600 للطبيب و400 للعيادة", () => {
    expect(splitAppointment(2000, 80)).toEqual({ doctorDzd: 1600, clinicDzd: 400 });
    expect(clinicSharePercent(80)).toBe(20);
  });
  it("نسب مختلفة لأطباء مختلفين على السعر نفسه", () => {
    expect(splitAppointment(2000, 85)).toEqual({ doctorDzd: 1700, clinicDzd: 300 });
  });
  it("الحدّان 0% و100%", () => {
    expect(splitAppointment(2000, 0)).toEqual({ doctorDzd: 0, clinicDzd: 2000 });
    expect(splitAppointment(2000, 100)).toEqual({ doctorDzd: 2000, clinicDzd: 0 });
    expect(clinicSharePercent(0)).toBe(100);
    expect(clinicSharePercent(100)).toBe(0);
  });
  it("التقريب لأقرب دينار والمجموع يساوي السعر دائمًا", () => {
    for (const price of [1, 7, 333, 1999, 2001, 12345]) {
      for (const share of [0, 1, 33, 50, 67, 85, 99, 100]) {
        const { doctorDzd, clinicDzd } = splitAppointment(price, share);
        expect(doctorDzd + clinicDzd).toBe(price);
        expect(Number.isInteger(doctorDzd) && Number.isInteger(clinicDzd)).toBe(true);
        expect(doctorDzd).toBeGreaterThanOrEqual(0);
        expect(clinicDzd).toBeGreaterThanOrEqual(0);
      }
    }
    expect(splitAppointment(1999, 85).doctorDzd).toBe(1699);
    expect(splitAppointment(5, 50).doctorDzd).toBe(3);
  });
});

describe("التحقق من المدخلات", () => {
  it("يقبل سعرًا ونسبة صالحين أو أحدهما فقط", () => {
    expect(clinicDoctorTermsSchema.safeParse({ appointmentPriceDzd: 2000, doctorSharePercent: 80 }).success).toBe(true);
    expect(clinicDoctorTermsSchema.safeParse({ doctorSharePercent: 0 }).success).toBe(true);
    expect(clinicDoctorTermsSchema.safeParse({ doctorSharePercent: 100 }).success).toBe(true);
    expect(clinicDoctorTermsSchema.safeParse({ appointmentPriceDzd: 0 }).success).toBe(true);
  });
  it.each([
    [{ doctorSharePercent: 101 }], [{ doctorSharePercent: -1 }], [{ doctorSharePercent: 80.5 }], [{ doctorSharePercent: "80" }],
    [{ doctorSharePercent: null }], [{ doctorSharePercent: NaN }], [{ appointmentPriceDzd: -5 }], [{ appointmentPriceDzd: 1.5 }],
    [{ appointmentPriceDzd: "2000" }], [{ appointmentPriceDzd: 10_000_001 }], [{ appointmentPriceDzd: Infinity }],
    [{}], [{ appointmentPriceDzd: 2000, clinicSharePercent: 20 }], [{ doctorSharePercent: 80, doctorId: "x" }],
  ])("يرفض %j", body => {
    expect(clinicDoctorTermsSchema.safeParse(body).success).toBe(false);
  });
  it("الدعوة: شروط اختيارية بنفس الحدود وتُرفض نسبة العيادة", () => {
    const base = { email: "Doc@Example.com" };
    const ok = clinicInviteSchema.safeParse({ ...base, appointmentPriceDzd: 2000, doctorSharePercent: 80 });
    expect(ok.success && ok.data.email).toBe("doc@example.com");
    expect(clinicInviteSchema.safeParse(base).success).toBe(true);
    expect(clinicInviteSchema.safeParse({ ...base, doctorSharePercent: 120 }).success).toBe(false);
    expect(clinicInviteSchema.safeParse({ ...base, clinicSharePercent: 10 }).success).toBe(false);
  });
});

describe("السعر الفعلي واللقطة", () => {
  const indep = { clinicId: null, consultationFee: 1500, clinicTerms: null };
  it("طبيب مستقل: سعره consultationFee بلا نسبة", () => {
    expect(effectiveAppointmentPrice(indep)).toBe(1500);
    expect(financialSnapshot(indep)).toEqual({ priceDzd: 1500, doctorSharePercent: null, clinicId: null });
  });
  it("طبيب في عيادة بشروط: سعر العيادة ونسبته", () => {
    const d = { clinicId: "c1", consultationFee: 1500, clinicTerms: terms() };
    expect(effectiveAppointmentPrice(d)).toBe(2000);
    expect(financialSnapshot(d)).toEqual({ priceDzd: 2000, doctorSharePercent: 80, clinicId: "c1" });
  });
  it("طبيب حالي في عيادة بلا شروط: يحتفظ بسعره ونسبته غير محددة (لا افتراض)", () => {
    const d = { clinicId: "c1", consultationFee: 1500, clinicTerms: null };
    expect(financialSnapshot(d)).toEqual({ priceDzd: 1500, doctorSharePercent: null, clinicId: "c1" });
  });
  it("شروط بلا سعر: السعر من consultationFee والنسبة محفوظة", () => {
    const d = { clinicId: "c1", consultationFee: 1500, clinicTerms: terms({ appointmentPriceDzd: null }) };
    expect(financialSnapshot(d)).toEqual({ priceDzd: 1500, doctorSharePercent: 80, clinicId: "c1" });
  });
  it("شروط عيادة أخرى لا تُطبَّق (الشروط تخص علاقة الطبيب بعيادته فقط)", () => {
    const d = { clinicId: "c2", consultationFee: 1500, clinicTerms: terms({ clinicId: "c1" }) };
    expect(financialSnapshot(d)).toEqual({ priceDzd: 1500, doctorSharePercent: null, clinicId: "c2" });
    const left = { clinicId: null, consultationFee: 1500, clinicTerms: terms() };
    expect(financialSnapshot(left)).toEqual({ priceDzd: 1500, doctorSharePercent: null, clinicId: null });
  });
  it("السعر 0 صالح ولا يُستبدل بسعر الطبيب", () => {
    expect(effectiveAppointmentPrice({ clinicId: "c1", consultationFee: 1500, clinicTerms: terms({ appointmentPriceDzd: 0 }) })).toBe(0);
  });
  it("اللقطة قيمة مستقلة: تعديل الشروط لاحقًا لا يغيّر لقطة محفوظة", () => {
    const d = { clinicId: "c1", consultationFee: 1500, clinicTerms: terms() };
    const saved = financialSnapshot(d);
    d.clinicTerms.appointmentPriceDzd = 5000; d.clinicTerms.doctorSharePercent = 50;
    expect(saved).toEqual({ priceDzd: 2000, doctorSharePercent: 80, clinicId: "c1" });
    expect(financialSnapshot(d).priceDzd).toBe(5000);
  });
});

describe("خصوصية العرض العام", () => {
  it("المريض يرى سعر العيادة فقط، بلا clinicTerms ولا أي نسبة", () => {
    const view = withPublicFee({ id: "d1", consultationFee: 1500, clinicTerms: { appointmentPriceDzd: 2000 } }) as Record<string, unknown>;
    expect(view.consultationFee).toBe(2000);
    expect("clinicTerms" in view).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/Share|Percent|clinicTerms/);
  });
  it("بلا سعر عيادة: السعر الأصلي، وطبيب مستقل (clinicTerms فارغ) كما هو", () => {
    expect(withPublicFee({ consultationFee: 1500, clinicTerms: null }).consultationFee).toBe(1500);
    expect(withPublicFee({ consultationFee: 1500, clinicTerms: { appointmentPriceDzd: null } }).consultationFee).toBe(1500);
    expect(withPublicFee({ consultationFee: null, clinicTerms: null }).consultationFee).toBeNull();
  });
});

describe("المستحقات: المكتملة فقط", () => {
  const row = (status: AppointmentStatus, priceDzd: number | null = 2000, doctorSharePercent: number | null = 80) => ({ status, priceDzd, doctorSharePercent });
  it("المكتملة تدخل المستحقات؛ الملغاة ولم يحضر والمعلقة تُعدّ ولا تُحسب مبلغًا", () => {
    const s = summarizeFinance([
      row(S.COMPLETED), row(S.COMPLETED), row(S.CANCELLED), row(S.NO_SHOW), row(S.CONFIRMED), row(S.PENDING),
      row(S.IN_PROGRESS), row(S.LATE), row(S.RESCHEDULE_REQUIRED),
    ]);
    expect(s).toMatchObject({ completedCount: 2, grossDzd: 4000, doctorDuesDzd: 3200, clinicShareDzd: 800, cancelledCount: 1, noShowCount: 1, pendingCount: 5, completedWithoutShare: 0 });
  });
  it("مكتمل بلا نسبة يظهر عددًا ولا يدخل المستحقات؛ بلا سعر لا يضيف مبلغًا", () => {
    const s = summarizeFinance([row(S.COMPLETED, 2000, null), row(S.COMPLETED, null, 80), row(S.COMPLETED)]);
    expect(s).toMatchObject({ completedCount: 3, grossDzd: 4000, doctorDuesDzd: 1600, clinicShareDzd: 400, completedWithoutShare: 2 });
  });
  it("أطباء بنسب مختلفة يُحسب كل موعد بنسبته المحفوظة هو", () => {
    const s = summarizeFinance([row(S.COMPLETED, 2000, 80), row(S.COMPLETED, 2000, 85)]);
    expect(s.doctorDuesDzd).toBe(1600 + 1700);
    expect(s.clinicShareDzd).toBe(400 + 300);
  });
});

describe("لوحة الطبيب: لقطات قديمة لا تتأثر بتغيير السعر", () => {
  it("مواعيد بلقطة 2000/80 تبقى كما هي مهما كان السعر الحالي", () => {
    const groups = [{ priceDzd: 2000, doctorSharePercent: 80, count: 10 }];
    const before = revenueFromGroups(groups, 0, 2000);
    const afterPriceChange = revenueFromGroups(groups, 0, 9999);
    expect(afterPriceChange).toEqual(before);
    expect(before).toMatchObject({ grossDzd: 20000, doctorDuesDzd: 16000, clinicShareDzd: 4000, completedWithoutShare: 0 });
  });
  it("مجموعات بأسعار ونسب مختلفة من فترات مختلفة", () => {
    const r = revenueFromGroups([
      { priceDzd: 2000, doctorSharePercent: 80, count: 3 }, { priceDzd: 2500, doctorSharePercent: 85, count: 2 },
    ], 0, 2500);
    expect(r.grossDzd).toBe(6000 + 5000);
    expect(r.doctorDuesDzd).toBe(3 * 1600 + 2 * 2125);
  });
  it("السابقة للميزة تُسعَّر بالسعر الحالي بلا استحقاق", () => {
    const r = revenueFromGroups([], 4, 1500);
    expect(r).toMatchObject({ grossDzd: 6000, doctorDuesDzd: 0, completedWithoutShare: 4 });
    expect(revenueFromGroups([], 4, null).grossDzd).toBe(0);
  });
  it("لقطة مستقلة (نسبة NULL) تُحتسب إيرادًا بلا استحقاق", () => {
    const r = revenueFromGroups([{ priceDzd: 1500, doctorSharePercent: null, count: 5 }], 0, 1500);
    expect(r).toMatchObject({ grossDzd: 7500, doctorDuesDzd: 0, completedWithoutShare: 5 });
  });
});

describe("اتساق سعر المريض", () => {
  const doctor = { id: "d", consultationFee: 1500, clinicTerms: { appointmentPriceDzd: 2000 } };
  it("لقطة الموعد تغلب السعر الحالي في كل الحقول، وبلا نسب", async () => {
    const { withAppointmentPrice } = await import("../src/lib/clinicFinance");
    const r: any = withAppointmentPrice({ id: "a", financial: { priceDzd: 1800 }, doctor: { ...doctor } });
    expect(r.priceDzd).toBe(1800);
    expect(r.doctor.consultationFee).toBe(1800);
    expect(JSON.stringify(r)).not.toMatch(/financial|clinicTerms|SharePercent/);
  });
  it("موعد سابق للميزة (بلا لقطة) يأخذ السعر الفعلي الحالي: سعر العيادة", async () => {
    const { withAppointmentPrice } = await import("../src/lib/clinicFinance");
    const r: any = withAppointmentPrice({ id: "a", financial: null, doctor: { ...doctor } });
    expect(r.priceDzd).toBe(2000);
    expect(r.doctor.consultationFee).toBe(2000);
  });
  it("applyAppointmentPrice يوحّد priceDzd وdoctor.consultationFee ويحذف financial", async () => {
    const { applyAppointmentPrice } = await import("../src/lib/clinicFinance");
    const r: any = applyAppointmentPrice({ id: "a", financial: { x: 1 }, doctor: { consultationFee: 999, firstName: "س" } }, 1600);
    expect(r).toEqual({ id: "a", priceDzd: 1600, doctor: { consultationFee: 1600, firstName: "س" } });
  });
});
