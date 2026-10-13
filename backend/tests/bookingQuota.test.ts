import { describe, it, expect, vi, beforeEach } from "vitest";

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@prisma/client", () => ({
  AppointmentStatus: {
    PENDING: "PENDING", CONFIRMED: "CONFIRMED", RESCHEDULE_REQUIRED: "RESCHEDULE_REQUIRED",
    LATE: "LATE", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED", NO_SHOW: "NO_SHOW",
  },
}));
vi.mock("../src/lib/prisma", () => ({ prisma: { appointment: { count } } }));
vi.mock("../src/lib/slots", () => ({ algeriaTodayUTCMidnight: () => new Date("2026-10-13T00:00:00Z") }));

// setup.ts يحاكي bookingQuota للاختبارات القديمة؛ هنا نختبر المنطق الحقيقي.
const {
  assertBookingQuota,
  MAX_ACTIVE_APPOINTMENTS_PER_PATIENT,
  MAX_ACTIVE_PER_PATIENT_PER_DOCTOR,
  MAX_CREATED_PER_PATIENT_PER_24H,
  MAX_CREATED_PER_PATIENT_PER_30D,
} = await vi.importActual<typeof import("../src/lib/bookingQuota")>("../src/lib/bookingQuota");

// الترتيب داخل assertBookingQuota: [نشطة كلها، نشطة لدى الطبيب، منشأة خلال 24 ساعة، منشأة خلال 30 يومًا]
const setCounts = (a: number, d: number, c: number, m = 0) => {
  count.mockReset();
  count.mockResolvedValueOnce(a).mockResolvedValueOnce(d).mockResolvedValueOnce(c).mockResolvedValueOnce(m);
};

describe("assertBookingQuota", () => {
  beforeEach(() => count.mockReset());

  it("يسمح بالحجز تحت كل السقوف", async () => {
    setCounts(0, 0, 0);
    await expect(assertBookingQuota("p1", "d1")).resolves.toBeUndefined();
  });

  it("يرفض (429) عند بلوغ سقف المواعيد النشطة", async () => {
    setCounts(MAX_ACTIVE_APPOINTMENTS_PER_PATIENT, 0, 0);
    await expect(assertBookingQuota("p1", "d1")).rejects.toMatchObject({ statusCode: 429 });
  });

  it("يرفض (429) عند بلوغ سقف المواعيد النشطة لدى الطبيب نفسه", async () => {
    setCounts(1, MAX_ACTIVE_PER_PATIENT_PER_DOCTOR, 0);
    await expect(assertBookingQuota("p1", "d1")).rejects.toMatchObject({ statusCode: 429 });
  });

  it("يرفض (429) عند بلوغ سقف الحجوزات خلال 24 ساعة (يشمل حلقة الحجز/الإلغاء)", async () => {
    setCounts(0, 0, MAX_CREATED_PER_PATIENT_PER_24H);
    await expect(assertBookingQuota("p1", "d1")).rejects.toMatchObject({ statusCode: 429 });
  });

  it("يرفض (429) عند بلوغ السقف الشهري (30 حجزًا خلال 30 يومًا)", async () => {
    setCounts(0, 0, 0, MAX_CREATED_PER_PATIENT_PER_30D);
    await expect(assertBookingQuota("p1", "d1")).rejects.toMatchObject({ statusCode: 429 });
  });

  it("بلا طبيب محدد لا يفحص سقف الطبيب", async () => {
    count.mockReset();
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(assertBookingQuota("p1", null)).resolves.toBeUndefined();
    expect(count).toHaveBeenCalledTimes(3);
  });
});
