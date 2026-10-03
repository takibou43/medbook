/** المريض (واجهات عامة) يرى سعر العيادة فقط، ولا تصله نسبة الطبيب أو العيادة أو clinicTerms بأي صيغة. */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const raw = () => ({
    id: "d1", firstName: "أمين", lastName: "ب", consultationFee: 1500, avgRating: 4, reviewsCount: 1, latitude: null, longitude: null,
    clinicTerms: { appointmentPriceDzd: 2000 }, reviews: [], schedules: [],
  });
  const db: any = {
    doctor: {
      findMany: vi.fn(async (args: any) => {
        // الاستعلام العام لا يجوز أن يطلب النسبة من القاعدة أصلًا.
        expect(JSON.stringify(args.select ?? {})).not.toMatch(/doctorSharePercent/);
        return [raw()];
      }),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async (args: any) => { expect(JSON.stringify(args.select)).not.toMatch(/doctorSharePercent/); return raw(); }),
    },
    clinic: { findFirst: vi.fn(async (args: any) => { expect(JSON.stringify(args.select)).not.toMatch(/doctorSharePercent/); return { id: "c1", nameAr: "ع", doctors: [raw()] }; }) },
  };
  return { db };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));

import { searchDoctors, getDoctorById } from "../src/modules/doctors/doctors.service";
import { publicClinic } from "../src/modules/clinics/clinics.service";

const clean = (v: unknown) => {
  const text = JSON.stringify(v);
  expect(text).not.toMatch(/clinicTerms|doctorSharePercent|clinicSharePercent|SharePercent/);
};

describe("خصوصية الواجهات العامة", () => {
  it("بحث الأطباء (بلا موقع)", async () => {
    const r = await searchDoctors({} as any);
    expect(r.items[0].consultationFee).toBe(2000); clean(r);
  });
  it("بحث الأطباء (مع موقع المريض)", async () => {
    const r = await searchDoctors({ lat: 36, lng: 6 } as any);
    expect(r.items[0].consultationFee).toBe(2000); clean(r);
  });
  it("صفحة الطبيب", async () => {
    const r = await getDoctorById("d1");
    expect(r.consultationFee).toBe(2000); clean(r);
  });
  it("صفحة العيادة العامة", async () => {
    const r = await publicClinic("c1");
    expect(r.doctors[0].consultationFee).toBe(2000); clean(r);
  });
});
