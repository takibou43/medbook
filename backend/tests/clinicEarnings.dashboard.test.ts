/**
 * لوحة الطبيب: الدخل من اللقطة المحفوظة (لا من السعر الحالي)، ومستحقات الطبيب لنفسه فقط، والمساعد لا يرى النسبة.
 * وحراسة منع تعديل الطبيب لسعره داخل عيادة لها مدير.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => {
  const st = { doctor: null as any, clinic: null as any, updates: [] as any[] };
  const span = (d: any) => (d ? new Date(d.lte).getTime() - new Date(d.gte).getTime() : -1);
  const window = (d: any) => (!d ? "total" : span(d) > 20 * 86400000 ? "month" : "today");
  const completed = { total: 10, month: 5, today: 1 } as Record<string, number>;
  const groups = {
    today: [{ priceDzd: 2000, doctorSharePercent: 80, _count: { _all: 1 } }],
    month: [{ priceDzd: 2000, doctorSharePercent: 80, _count: { _all: 3 } }, { priceDzd: 2500, doctorSharePercent: 85, _count: { _all: 1 } }],
    total: [{ priceDzd: 2000, doctorSharePercent: 80, _count: { _all: 6 } }, { priceDzd: 2500, doctorSharePercent: 85, _count: { _all: 2 } }],
  } as Record<string, any[]>;
  const db: any = {
    doctor: {
      findUnique: vi.fn(async ({ where }: any) => (where.id === st.doctor?.id || where.userId === st.doctor?.userId ? st.doctor : null)),
      update: vi.fn(async (args: any) => { st.updates.push(args); return { ...st.doctor, ...args.data }; }),
    },
    clinic: { findUnique: vi.fn(async () => st.clinic) },
    assistant: { findUnique: vi.fn(async () => ({ isActive: true, doctorId: st.doctor.id, doctor: { user: { isActive: true } } })) },
    appointment: {
      count: vi.fn(async ({ where }: any) => (where.status === "COMPLETED" ? completed[window(where.date)] : 0)),
      findMany: vi.fn(async () => []),
    },
    appointmentFinancial: { groupBy: vi.fn(async ({ where }: any) => groups[window(where.appointment.date)]) },
  };
  return { db, st };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("../src/modules/appointments/appointments.service", () => ({ autoExpireStaleAppointments: vi.fn(async () => undefined) }));

import { getDashboardStats, updateOwnProfile } from "../src/modules/doctors/doctorSelf.service";

const clinicDoctor = () => ({
  id: "d1", userId: "u1", clinicId: "c1", consultationFee: 1500, subscriptionStatus: "ACTIVE", verificationStatus: "VERIFIED", avgRating: 4, reviewsCount: 3,
  clinicTerms: { clinicId: "c1", appointmentPriceDzd: 2000, doctorSharePercent: 80 },
});

beforeEach(() => { h.st.doctor = clinicDoctor(); h.st.clinic = { ownerId: "owner" }; h.st.updates.length = 0; });

describe("لوحة الطبيب في عيادة", () => {
  it("الدخل والمستحقات من اللقطات، والسابق للميزة بالسعر الحالي بلا استحقاق", async () => {
    const s: any = await getDashboardStats("u1", "DOCTOR" as any);
    expect(s.estimatedRevenueToday).toBe(2000);
    expect(s.estimatedRevenueMonth).toBe(3 * 2000 + 2500 + 1 * 2000);
    expect(s.estimatedRevenue).toBe(6 * 2000 + 2 * 2500 + 2 * 2000);
    expect(s.clinicEarnings).toMatchObject({
      appointmentPriceDzd: 2000, doctorSharePercent: 80, clinicSharePercent: 20,
      duesToday: 1600, duesMonth: 3 * 1600 + 2125, duesTotal: 6 * 1600 + 2 * 2125, completedWithoutShareMonth: 1,
    });
    expect(s.clinicEarnings.completedWithoutShareTotal).toBeGreaterThanOrEqual(s.clinicEarnings.completedWithoutShareMonth);
  });
  it("تغيير السعر والنسبة الحاليين لا يغيّر الأرقام المحسوبة من اللقطات السابقة", async () => {
    const before: any = await getDashboardStats("u1", "DOCTOR" as any);
    h.st.doctor.clinicTerms = { clinicId: "c1", appointmentPriceDzd: 9999, doctorSharePercent: 10 };
    const after: any = await getDashboardStats("u1", "DOCTOR" as any);
    // الجزء المبني على اللقطات ثابت؛ الفرق الوحيد هو تسعير موعد سابق للميزة (بلا لقطة) بالسعر الحالي.
    expect(after.clinicEarnings.duesToday).toBe(before.clinicEarnings.duesToday);
    expect(after.clinicEarnings.duesMonth).toBe(before.clinicEarnings.duesMonth);
    expect(after.clinicEarnings.duesTotal).toBe(before.clinicEarnings.duesTotal);
    expect(after.estimatedRevenueToday).toBe(before.estimatedRevenueToday);
    expect(after.estimatedRevenueMonth - before.estimatedRevenueMonth).toBe(1 * (9999 - 2000));
  });
  it("المساعد: لا clinicEarnings ولا أي نسبة أو مستحقات", async () => {
    const s: any = await getDashboardStats("asst-user", "ASSISTANT" as any);
    expect(s.clinicEarnings).toBeUndefined();
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/doctorShare|clinicShare|dues|clinicEarnings|Percent/);
  });
  it("طبيب مستقل: clinicEarnings = null ولا مستحقات", async () => {
    h.st.doctor = { ...clinicDoctor(), clinicId: null, clinicTerms: null };
    const s: any = await getDashboardStats("u1", "DOCTOR" as any);
    expect(s.clinicEarnings).toBeNull();
    expect(s.consultationFee).toBe(1500);
  });
  it("طبيب في عيادة بلا نسبة محددة: السعر الحالي، ونسبة null ومستحقات 0", async () => {
    h.st.doctor.clinicTerms = null;
    const s: any = await getDashboardStats("u1", "DOCTOR" as any);
    expect(s.clinicEarnings).toMatchObject({ appointmentPriceDzd: 1500, doctorSharePercent: null, clinicSharePercent: null });
  });
});

describe("الطبيب لا يعدّل سعر الموعد داخل عيادة لها مدير", () => {
  it("تعديل السعر إلى قيمة مختلفة 403 ولا يُكتب", async () => {
    await expect(updateOwnProfile("u1", { consultationFee: 99999 })).rejects.toMatchObject({ statusCode: 403 });
    expect(h.st.updates).toHaveLength(0);
  });
  it("إرسال القيمة الحالية نفسها (واجهة قديمة) يُتجاهل بلا خطأ وبقية الحقول تُحفظ", async () => {
    await updateOwnProfile("u1", { consultationFee: 1500, bio: "نبذة" });
    expect(h.st.updates[0].data).toEqual({ bio: "نبذة" });
  });
  it("طبيب مستقل يعدّل سعره كما كان", async () => {
    h.st.doctor = { ...clinicDoctor(), clinicId: null, clinicTerms: null };
    await updateOwnProfile("u1", { consultationFee: 1800 });
    expect(h.st.updates[0].data).toEqual({ consultationFee: 1800 });
  });
  it("عيادة قديمة بلا مدير (ownerId فارغ) تحتفظ بسلوكها السابق", async () => {
    h.st.clinic = { ownerId: null };
    await updateOwnProfile("u1", { consultationFee: 1800 });
    expect(h.st.updates[0].data).toEqual({ consultationFee: 1800 });
  });
});

describe("حراسة: كل مسار ينشئ موعدًا يحفظ اللقطة المالية", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => {
    const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
  it("كل appointment.create في src فيه financial", () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, "../src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/appointment\.create\(\{/g)) {
        const body = src.slice(m.index!, m.index! + 700);
        if (!/financial[,:\s]/.test(body)) offenders.push(`${file}@${m.index}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
