/**
 * منطق الميزات الأربع (+ موعد العودة) — دوال نقية بلا قاعدة بيانات ولا Prisma Client:
 * عدّاد الحجوزات (الشهر بتوقيت الجزائر + النصوص)، الإحالات (الكود + حساب التمديد)، تخصص الأسنان،
 * قواعد خطط العلاج وموعد العودة، المستفيد، تنظيف النصوص، إخفاء كود الإحالة، ومخطط أفراد العائلة.
 */
import { describe, it, expect } from "vitest";
import { algeriaMonthRange, algeriaDateString } from "../src/lib/algeriaMonth";
import { buildCounterDisplay, arabicAppointmentsCount, STATS_DEFINITION } from "../src/modules/publicStats/publicStats.logic";
import { computeReferralExtension, generateReferralCode, normalizeReferralCode, REWARDABLE_STATUSES } from "../src/modules/referrals/referrals.logic";
import { isDentalSpecialty } from "../src/lib/dentalSpecialty";
import {
  addCalendarMonths,
  canTransitionPlan,
  followUpNotificationText,
  resolveFollowUpBeneficiary,
  sameBeneficiary,
  withinFollowUpHorizon,
} from "../src/modules/treatment/treatment.logic";
import { beneficiaryOf } from "../src/lib/beneficiary";
import { cleanText, cleanMultiline } from "../src/lib/textClean";
import { redactDoctorSecrets } from "../src/lib/redact";
import { createFamilyMemberSchema, updateFamilyMemberSchema } from "../src/modules/family/family.schema";
import { followUpAppointmentSchema, createPlanSchema } from "../src/modules/treatment/treatment.schema";

const DAY = 86_400_000;

describe("عدّاد الحجوزات: الشهر الحالي بتوقيت الجزائر (Africa/Algiers = UTC+1 ثابت)", () => {
  it("منتصف الشهر: الحدود أول الشهر 00:00 الجزائر (= 23:00Z من اليوم السابق)", () => {
    const r = algeriaMonthRange(new Date("2026-09-15T10:00:00Z"));
    expect(r.period).toBe("2026-09");
    expect(r.start.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-30T23:00:00.000Z");
  });

  it("حدّ منتصف الليل: 30 سبتمبر 23:30Z هو 1 أكتوبر 00:30 في الجزائر → أكتوبر", () => {
    expect(algeriaMonthRange(new Date("2026-09-30T23:30:00Z")).period).toBe("2026-10");
    expect(algeriaMonthRange(new Date("2026-09-30T22:59:59.999Z")).period).toBe("2026-09");
    expect(algeriaMonthRange(new Date("2026-09-30T23:00:00.000Z")).period).toBe("2026-10");
  });

  it("تغيّر السنة: 31 ديسمبر 23:15Z = 1 يناير في الجزائر", () => {
    const r = algeriaMonthRange(new Date("2026-12-31T23:15:00Z"));
    expect(r.period).toBe("2027-01");
    expect(r.start.toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(r.end.toISOString()).toBe("2027-01-31T23:00:00.000Z");
    const dec = algeriaMonthRange(new Date("2026-12-31T12:00:00Z"));
    expect(dec.period).toBe("2026-12");
    expect(dec.end.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("فبراير في سنة كبيسة وغير كبيسة", () => {
    expect(algeriaMonthRange(new Date("2028-02-10T00:00:00Z")).end.toISOString()).toBe("2028-02-29T23:00:00.000Z");
    expect(algeriaMonthRange(new Date("2027-02-10T00:00:00Z")).end.toISOString()).toBe("2027-02-28T23:00:00.000Z");
  });

  it("تاريخ اليوم بتوقيت الجزائر", () => {
    expect(algeriaDateString(new Date("2026-09-29T23:10:00Z"))).toBe("2026-09-30");
  });
});

describe("عدّاد الحجوزات: النص المعروض وقواعد الخصوصية", () => {
  it("0 → دعوة عادية بلا «0 حجز»", () => {
    const d = buildCounterDisplay(0);
    expect(d.displayCount).toBeNull();
    expect(d.level).toBe("NONE");
    expect(d.displayText).not.toMatch(/0/);
    expect(d.displayText).toContain("احجز");
  });

  it.each([1, 5, 9])("%i (1–9) → لا رقم دقيق للعامة (count وdisplayCount = null)", (n) => {
    const d = buildCounterDisplay(n);
    expect(d.count).toBeNull();
    expect(d.displayCount).toBeNull();
    expect(d.level).toBe("LOW");
    expect(d.displayText).toBe("بدأ المرضى بالحجز عبر MedBook هذا الشهر");
    expect(d.displayText).not.toMatch(/\d/);
  });

  it("10 فأكثر → الرقم الفعلي بلا + ولا تقريب", () => {
    expect(buildCounterDisplay(10).displayText).toBe("تم حجز 10 مواعيد هذا الشهر");
    const d = buildCounterDisplay(123);
    expect(d.count).toBe(123);
    expect(d.displayCount).toBe(123);
    expect(d.displayText).toBe("تم حجز 123 موعدًا هذا الشهر");
    expect(d.displayText).not.toContain("+");
  });

  it("مع ولاية: «... هذا الشهر في ولاية X»", () => {
    expect(buildCounterDisplay(42, "ميلة").displayText).toBe("تم حجز 42 موعدًا هذا الشهر في ولاية ميلة");
    expect(buildCounterDisplay(3, "ميلة").displayText).toBe("بدأ المرضى بالحجز عبر MedBook هذا الشهر في ولاية ميلة");
  });

  it("صيغة المعدود بالعربية", () => {
    expect(arabicAppointmentsCount(11)).toBe("11 موعدًا");
    expect(arabicAppointmentsCount(100)).toBe("100 موعد");
    expect(arabicAppointmentsCount(103)).toBe("103 مواعيد");
    expect(STATS_DEFINITION).toBe("NON_CANCELLED_CREATED_THIS_MONTH");
  });
});

describe("الإحالات: الكود وحساب الثلاثين يومًا", () => {
  const now = new Date("2026-10-01T10:00:00Z");

  it("الكود بصيغة MB-XXXXXXXX من أبجدية بلا محارف ملتبسة، والتطبيع يقبل الأحرف الصغيرة والمسافات", () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^MB-[A-HJKMNP-Z2-9]{8}$/);
    expect(normalizeReferralCode(" mb-" + code.slice(3).toLowerCase() + " ")).toBe(code);
    expect(normalizeReferralCode(code.slice(3))).toBe(code);
    expect(normalizeReferralCode("MB-0000000O")).toBeNull();
    expect(normalizeReferralCode("MB-ABC")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    // جسم يبدأ بـMB دون بادئة لا يُقصّ خطأً.
    expect(normalizeReferralCode("MBCDEFGH")).toBe("MB-MBCDEFGH");
    expect(normalizeReferralCode("mb-MBCDEFGH")).toBe("MB-MBCDEFGH");
  });

  it("اشتراك فعّال: الإضافة تبدأ من تاريخ انتهائه", () => {
    const exp = new Date("2026-11-15T00:00:00Z");
    const r = computeReferralExtension({ subscriptionStatus: "ACTIVE", subscriptionExpiresAt: exp }, now, null);
    expect(r.getTime()).toBe(exp.getTime() + 30 * DAY);
  });

  it("اشتراك منتهٍ أو غير مدفوع: من الآن", () => {
    const expired = computeReferralExtension({ subscriptionStatus: "EXPIRED", subscriptionExpiresAt: new Date("2026-08-01T00:00:00Z") }, now, null);
    expect(expired.getTime()).toBe(now.getTime() + 30 * DAY);
    const unpaid = computeReferralExtension({ subscriptionStatus: "UNPAID", subscriptionExpiresAt: null }, now, null);
    expect(unpaid.getTime()).toBe(now.getTime() + 30 * DAY);
    // ACTIVE لكن تاريخه مضى (قبل أن تمرّ مهمة المزامنة): من الآن، لا من الماضي.
    const stale = computeReferralExtension({ subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date("2026-09-01T00:00:00Z") }, now, null);
    expect(stale.getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it("تجربة مجانية سارية: المكافأة تُضاف بعد نهاية التجربة ولا تضيع داخلها", () => {
    const trialEnd = new Date("2026-12-31T23:59:59Z");
    const unpaid = computeReferralExtension({ subscriptionStatus: "UNPAID", subscriptionExpiresAt: null }, now, trialEnd);
    expect(unpaid.getTime()).toBe(trialEnd.getTime() + 30 * DAY);
    const inTrial = computeReferralExtension({ subscriptionStatus: "ACTIVE", subscriptionExpiresAt: trialEnd }, now, trialEnd);
    expect(inTrial.getTime()).toBe(trialEnd.getTime() + 30 * DAY);
    // تجربة انتهت: لا أثر لها.
    const after = computeReferralExtension({ subscriptionStatus: "EXPIRED", subscriptionExpiresAt: null }, new Date("2027-02-01T00:00:00Z"), trialEnd);
    expect(after.toISOString()).toBe(new Date(new Date("2027-02-01T00:00:00Z").getTime() + 30 * DAY).toISOString());
  });

  it("REWARDED ليست ضمن الحالات القابلة للمكافأة (لا مكافأة ثانية)", () => {
    expect(REWARDABLE_STATUSES).not.toContain("REWARDED" as any);
  });
});

describe("تخصص الأسنان (helper مركزي بلا slug)", () => {
  it.each([
    [{ nameAr: "طب الأسنان", nameFr: "Dentisterie" }, true],
    [{ nameAr: "طب الاسنان", nameFr: null }, true],
    [{ nameAr: "جراحة الأسنان", nameFr: null }, true],
    [{ nameAr: "تقويم الأسنان", nameFr: "Orthodontie" }, true],
    [{ nameAr: "x", nameFr: "Chirurgie dentaire" }, true],
    [{ nameAr: "x", nameFr: "Stomatologie" }, true],
    [{ nameAr: "طب عام", nameFr: "Médecine générale" }, false],
    [{ nameAr: "طب العيون", nameFr: "Ophtalmologie" }, false],
    [null, false],
  ])("%j → %s", (sp, expected) => {
    expect(isDentalSpecialty(sp as any)).toBe(expected);
  });
});

describe("خطط العلاج وموعد العودة: قواعد نقية", () => {
  it("الخطة النشطة وحدها تُغلق", () => {
    expect(canTransitionPlan("ACTIVE", "COMPLETED")).toBe(true);
    expect(canTransitionPlan("ACTIVE", "CANCELLED")).toBe(true);
    expect(canTransitionPlan("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionPlan("CANCELLED", "ACTIVE")).toBe(false);
  });

  it("المستفيد: لا تغيير ضمني، والاختيار الصريح فقط يغيّره", () => {
    expect(resolveFollowUpBeneficiary("fm-1", undefined)).toBe("fm-1");
    expect(resolveFollowUpBeneficiary(null, undefined)).toBeNull();
    expect(resolveFollowUpBeneficiary("fm-1", null)).toBeNull();
    expect(resolveFollowUpBeneficiary(null, "fm-2")).toBe("fm-2");
    expect(sameBeneficiary(null, undefined)).toBe(true);
    expect(sameBeneficiary("a", "b")).toBe(false);
  });

  it("بعد 6 أشهر مع قصّ نهاية الشهر", () => {
    expect(addCalendarMonths(new Date("2026-09-30T00:00:00Z"), 6).toISOString().slice(0, 10)).toBe("2027-03-30");
    expect(addCalendarMonths(new Date("2026-08-31T00:00:00Z"), 6).toISOString().slice(0, 10)).toBe("2027-02-28");
  });

  it("أفق موعد العودة: لا ماضٍ، وحتى نحو سنة", () => {
    const today = new Date("2026-09-30T00:00:00Z");
    expect(withinFollowUpHorizon(new Date("2026-09-29T00:00:00Z"), today)).toBe(false);
    expect(withinFollowUpHorizon(new Date("2027-03-30T00:00:00Z"), today)).toBe(true);
    expect(withinFollowUpHorizon(new Date("2028-01-01T00:00:00Z"), today)).toBe(false);
  });

  it("نص الإشعار مطابق للمطلوب ولا يذكر SMS", () => {
    expect(followUpNotificationText({ doctorName: "أمين بوزيد", date: "2026-10-05", startTime: "09:20" })).toBe(
      "برمج لك الدكتور أمين بوزيد موعد عودة يوم 2026-10-05 على الساعة 09:20."
    );
    expect(followUpNotificationText({ doctorName: "أمين", date: "2026-10-05", startTime: "09:20", beneficiaryName: "ياسين" })).toContain("لـياسين");
  });

  it("مخطط موعد العودة: الوقت HH:mm صالح، مفتاح منع التكرار إلزامي، ولا حقول إضافية", () => {
    const key = "2f1c7a36-8b2e-4f0e-9c1d-5a6b7c8d9e0f";
    expect(followUpAppointmentSchema.safeParse({ date: "2026-10-05", startTime: "09:20", idempotencyKey: key }).success).toBe(true);
    expect(followUpAppointmentSchema.safeParse({ date: "2026-10-05", startTime: "25:00", idempotencyKey: key }).success).toBe(false);
    expect(followUpAppointmentSchema.safeParse({ date: "2026-10-05", startTime: "09:20" }).success).toBe(false);
    expect(followUpAppointmentSchema.safeParse({ date: "2026-10-05", startTime: "09:20", idempotencyKey: key, status: "COMPLETED" }).success).toBe(false);
  });

  it("مخطط الخطة: لا doctorId من العميل، والعنوان يُنظَّف", () => {
    const pid = "2f1c7a36-8b2e-4f0e-9c1d-5a6b7c8d9e0f";
    expect(createPlanSchema.safeParse({ patientId: pid, title: "تقويم", doctorId: pid }).success).toBe(false);
    const ok = createPlanSchema.parse({ patientId: pid, title: "  علاج ‮ عصب  " });
    expect(ok.title).toBe("علاج عصب");
  });
});

describe("المستفيد من الموعد", () => {
  it("موعد لفرد عائلة: الاسم وصلة القرابة فقط", () => {
    const b = beneficiaryOf({
      familyMemberId: "fm",
      familyMember: { id: "fm", firstName: "ياسين", lastName: "ع", relationship: "CHILD" },
      patient: { firstName: "سارة", lastName: "ع" },
    });
    expect(b).toEqual({ type: "FAMILY_MEMBER", name: "ياسين ع", relationship: "CHILD", familyMemberId: "fm" });
  });
  it("موعد ذاتي أو حجز ضيف قديم: SELF", () => {
    expect(beneficiaryOf({ familyMemberId: null, guestFirstName: "سارة", guestLastName: "ع" }).type).toBe("SELF");
    expect(beneficiaryOf({ patient: { firstName: "سارة", lastName: "ع" } }).name).toBe("سارة ع");
  });
});

describe("تنظيف النصوص وإخفاء كود الإحالة", () => {
  it("يحذف محارف التحكم والاتجاه غير المرئية ويوحّد المسافات", () => {
    expect(cleanText("  محمد‏  \u0007بن‮علي ")).toBe("محمد بن علي");
    expect(cleanMultiline("سطر 1\r\n\r\n\r\n\r\nسطر 2")).toBe("سطر 1\n\nسطر 2");
  });
  it("referralCode لا يصل في أي كائن متداخل، والتواريخ تبقى كما هي", () => {
    const d = new Date();
    const out = redactDoctorSecrets({ id: "a", date: d, doctor: { id: "d", referralCode: "MB-XXXX", specialty: { nameAr: "x" } }, list: [{ referralCode: "y" }] });
    expect(JSON.stringify(out)).not.toContain("referralCode");
    expect(out.date).toBe(d);
    expect(out.doctor.specialty.nameAr).toBe("x");
  });
});

describe("مخطط أفراد العائلة", () => {
  it("إنشاء صالح + تنظيف الاسم", () => {
    const v = createFamilyMemberSchema.parse({ firstName: "  ياسين  ", lastName: "بن علي", relationship: "CHILD", birthDate: "2018-05-02" });
    expect(v.firstName).toBe("ياسين");
    expect((v.birthDate as Date).toISOString().slice(0, 10)).toBe("2018-05-02");
  });
  it("يرفض: ownerPatientId من العميل، تاريخ ميلاد مستقبلي أو غير موجود، اسم طويل، صلة غير معروفة", () => {
    expect(createFamilyMemberSchema.safeParse({ firstName: "يا", lastName: "بن", relationship: "CHILD", ownerPatientId: "x" }).success).toBe(false);
    expect(createFamilyMemberSchema.safeParse({ firstName: "ياسين", lastName: "بن", relationship: "CHILD", birthDate: "2999-01-01" }).success).toBe(false);
    expect(createFamilyMemberSchema.safeParse({ firstName: "ياسين", lastName: "بن", relationship: "CHILD", birthDate: "2020-02-30" }).success).toBe(false);
    expect(createFamilyMemberSchema.safeParse({ firstName: "ي".repeat(61), lastName: "بن", relationship: "CHILD" }).success).toBe(false);
    expect(createFamilyMemberSchema.safeParse({ firstName: "ياسين", lastName: "بن", relationship: "COUSIN" }).success).toBe(false);
    expect(updateFamilyMemberSchema.safeParse({ ownerPatientId: "x" }).success).toBe(false);
  });
});
