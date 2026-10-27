import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  now: new Date("2031-03-11T14:40:00.000Z"),
  target: { id: "target", startTime: "15:50", status: "CONFIRMED", skipCredits: 0, calledAt: null, arrivedAt: null },
  current: { id: "current", startTime: "15:30", status: "IN_PROGRESS", skipCredits: 0, calledAt: new Date("2031-03-11T14:30:00.000Z"), arrivedAt: null },
  db: {
    appointment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    appointmentReminder: { findMany: vi.fn(async () => []) },
    appointmentFinancial: { findUnique: vi.fn(async () => ({ priceDzd: 1500 })) },
    doctor: { findUnique: vi.fn() },
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("../src/modules/appointments/appointments.service", () => ({ estimateSessionMinutes: vi.fn(async () => 20) }));
import { getAppointmentQueueStatus } from "../src/modules/booking/booking.service";

describe("patient queue status estimate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(h.now);
    vi.clearAllMocks();
    h.db.appointment.findUnique.mockResolvedValue({
      id: "target", date: new Date("2031-03-11T00:00:00.000Z"), startTime: "15:50", status: "CONFIRMED",
      doctor: { id: "doctor", slotDurationMin: 20, dutyEndsAt: new Date("2031-03-11T15:00:00.000Z"), specialty: null, clinic: null, city: null, wilaya: null },
    });
    h.db.appointment.findMany.mockResolvedValue([h.current, h.target]);
  });
  afterEach(() => vi.useRealTimers());

  it("subtracts time since actual admission from the active consultation estimate", async () => {
    const result = await getAppointmentQueueStatus("target");
    // جلسة 20 دقيقة بدأها الخادم قبل 10 دقائق، ومعها مريض حاضر واحد بالداخل.
    expect(result.aheadOfYou).toBe(1);
    expect(result.estimatedWaitMinutes).toBe(10);
  });
});
