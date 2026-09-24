/**
 * lib/slotAssign.ts — «الوقت المطلوب أو أقرب وقت شاغر بعده» (منطق نقي + إعادة المحاولة عند P2002).
 * قاعدة البيانات والقفل مستبدلان بمحاكاة حتمية: نستطيع فرض سباق على الوقت البديل نفسه في كل محاولة.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const state = {
    booked: [] as { startTime: string; endTime: string }[],
    // عدد المرات التي يسبقنا فيها «كاتب آخر» إلى الوقت الذي اخترناه (يُدرجه قبلنا ثم نحصل على P2002)
    stealNext: 0,
    inserted: [] as string[],
    transactions: 0,
  };
  return { state };
});

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      h.state.transactions++;
      const tx = {
        appointment: {
          findMany: async () => h.state.booked.map((b) => ({ ...b })),
          create: async ({ data }: any) => {
            if (h.state.stealNext > 0) {
              h.state.stealNext--;
              h.state.booked.push({ startTime: data.startTime, endTime: data.endTime }); // الكاتب الآخر فاز به
              const { Prisma: P } = await import("@prisma/client");
              throw new P.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
            }
            h.state.booked.push({ startTime: data.startTime, endTime: data.endTime });
            h.state.inserted.push(data.startTime);
            return { id: "a-" + data.startTime, ...data };
          },
        },
      };
      return fn(tx);
    },
  },
}));
vi.mock("../src/lib/doctorLock", () => ({
  lockDoctorQueue: async () => undefined,
  withDoctorQueueTurn: async (_id: string, _ms: number, fn: () => Promise<unknown>) => fn(),
  DoctorQueueBusyError: class extends Error {},
}));

import {
  reserveRequestedOrNextSlot,
  firstFreeSlotAtOrAfter,
  NoSlotAvailableError,
  SlotRaceExhaustedError,
  MAX_SLOT_ATTEMPTS,
  slotAssignStats,
} from "../src/lib/slotAssign";

const day = new Date("2031-03-03T00:00:00Z"); // يوم إثنين مستقبلي
const sched = (startTime: string, endTime: string) => ({ dayOfWeek: day.getUTCDay(), startTime, endTime, isException: false, exceptionDate: null, isOff: false });
const doctor = { id: "doc", slotDurationMin: 10, schedules: [sched("08:00", "12:00"), sched("14:00", "16:00")] };
const never = () => false;
const create = (tx: any, slot: { startTime: string; endTime: string }) =>
  tx.appointment.create({ data: { startTime: slot.startTime, endTime: slot.endTime } });

beforeEach(() => {
  h.state.booked = [];
  h.state.stealNext = 0;
  h.state.inserted = [];
  h.state.transactions = 0;
});

describe("firstFreeSlotAtOrAfter (دالة نقية)", () => {
  const s = doctor.schedules;
  it("الوقت المطلوب شاغر → هو نفسه", () => {
    expect(firstFreeSlotAtOrAfter(day, s, [], 10, "09:00", new Set(), never)).toBe("09:00");
  });
  it("المطلوب ومن بعده مشغولون → أول شاغر بعده (لا قبله أبدًا)", () => {
    const booked = [{ startTime: "09:00", endTime: "09:10" }, { startTime: "09:10", endTime: "09:20" }];
    expect(firstFreeSlotAtOrAfter(day, s, booked, 10, "09:00", new Set(), never)).toBe("09:20");
  });
  it("موعد مسبق بمدة مختلفة يتداخل جزئيًا → يُتخطّى كل وقت يتقاطع معه", () => {
    expect(firstFreeSlotAtOrAfter(day, s, [{ startTime: "09:05", endTime: "09:25" }], 10, "09:00", new Set(), never)).toBe("09:30");
  });
  it("الاستراحة (12:00-14:00) لا تُحجز: آخر الصباح مشغول → 14:00", () => {
    const booked = [{ startTime: "11:50", endTime: "12:00" }];
    expect(firstFreeSlotAtOrAfter(day, s, booked, 10, "11:50", new Set(), never)).toBe("14:00");
  });
  it("لا يتجاوز نهاية الدوام: كل ما بعد المطلوب مشغول → null (لا يوم آخر ولا وقت خارج الدوام)", () => {
    const booked = [{ startTime: "15:40", endTime: "16:00" }];
    expect(firstFreeSlotAtOrAfter(day, s, booked, 10, "15:40", new Set(), never)).toBeNull();
    expect(firstFreeSlotAtOrAfter(day, s, [], 10, "16:00", new Set(), never)).toBeNull();
  });
  it("يستبعد أوقاتًا فشلت للتو (exclude) والأوقات الماضية", () => {
    expect(firstFreeSlotAtOrAfter(day, s, [], 10, "09:00", new Set(["09:00", "09:10"]), never)).toBe("09:20");
    expect(firstFreeSlotAtOrAfter(day, s, [], 10, "09:00", new Set(), (_d, t) => t < "10:00")).toBe("10:00");
  });
});

describe("reserveRequestedOrNextSlot", () => {
  it("المطلوب شاغر → يُحجز كما هو بمحاولة واحدة", async () => {
    const r = await reserveRequestedOrNextSlot({ doctor, date: day, requestedStart: "09:00", create });
    expect(r.slot).toEqual({ startTime: "09:00", endTime: "09:10", slotMinutes: 10 });
    expect(r.shifted).toBe(false);
    expect(r.attempts).toBe(1);
  });

  it("المطلوب محجوز → أقرب وقت بعده، shifted = true", async () => {
    h.state.booked = [{ startTime: "09:00", endTime: "09:10" }];
    const r = await reserveRequestedOrNextSlot({ doctor, date: day, requestedStart: "09:00", create });
    expect(r.slot.startTime).toBe("09:10");
    expect(r.shifted).toBe(true);
  });

  it("سباق على الوقت البديل نفسه (P2002 مرتين متتاليتين) → يعيد الحساب ويأخذ الوقت التالي، بلا 409", async () => {
    h.state.booked = [{ startTime: "09:00", endTime: "09:10" }]; // المطلوب مأخوذ أصلًا
    h.state.stealNext = 2; // 09:10 ثم 09:20 يسرقهما كاتب آخر لحظة إدراجنا
    const before = slotAssignStats.p2002Retries;
    const r = await reserveRequestedOrNextSlot({ doctor, date: day, requestedStart: "09:00", create });
    expect(r.slot.startTime).toBe("09:30");
    expect(r.attempts).toBe(3);
    expect(slotAssignStats.p2002Retries - before).toBe(2);
    expect(h.state.inserted).toEqual(["09:30"]); // صف واحد فقط لنا
  });

  it(`حد منطقي للمحاولات: P2002 في كل مرة → يتوقف بعد ${MAX_SLOT_ATTEMPTS} محاولات (لا حلقة لا نهائية)`, async () => {
    h.state.stealNext = 1000;
    await expect(reserveRequestedOrNextSlot({ doctor, date: day, requestedStart: "09:00", create })).rejects.toBeInstanceOf(SlotRaceExhaustedError);
    expect(h.state.transactions).toBe(MAX_SLOT_ATTEMPTS);
    expect(h.state.inserted).toEqual([]);
  });

  it("اليوم ممتلئ بعد المطلوب → NoSlotAvailableError فورًا بلا إدراج", async () => {
    h.state.booked = [{ startTime: "15:00", endTime: "16:00" }];
    await expect(reserveRequestedOrNextSlot({ doctor, date: day, requestedStart: "15:00", create })).rejects.toBeInstanceOf(NoSlotAvailableError);
    expect(h.state.transactions).toBe(1);
    expect(h.state.inserted).toEqual([]);
  });

  it("خطأ آخر غير P2002 لا يُعاد ولا يُبتلع", async () => {
    const boom = () => Promise.reject(new Error("boom"));
    await expect(reserveRequestedOrNextSlot({ doctor, date: day, requestedStart: "09:00", create: boom })).rejects.toThrow("boom");
    expect(h.state.transactions).toBe(1);
  });

  it("مدة الموعد = مدة جلسة الطبيب، والافتراضي 20 إن لم تُضبط", async () => {
    const r = await reserveRequestedOrNextSlot({ doctor: { ...doctor, slotDurationMin: 0 }, date: day, requestedStart: "09:00", create });
    expect(r.slot).toEqual({ startTime: "09:00", endTime: "09:20", slotMinutes: 20 });
    expect(Prisma).toBeTruthy();
  });
});
