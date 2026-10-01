import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentStatus } from "@prisma/client";

/**
 * قاعدة المنتج: عطلة يوم كامل (isOff=true) = إلغاء نهائي للمواعيد النشطة (PENDING/CONFIRMED) وإشعار أصحابها؛
 * ساعات جزئية أو تغيير الجدول الأسبوعي = RESCHEDULE_REQUIRED. الحالات الأخرى لا تُمس.
 * والإشعار والعدّ يرتبطان فقط بالصفوف التي تغيّرت فعلًا (حماية من سباق القراءة/الكتابة).
 * قاعدة بيانات وهمية في الذاكرة — لا اتصال بأي قاعدة حقيقية.
 */

type Row = { id: string; doctorId: string; date: Date; startTime: string; endTime: string; status: AppointmentStatus; patient: { userId: string } | null };

const db = vi.hoisted(() => ({
  appointments: [] as any[],
  schedules: [] as any[],
  // يُستدعى قبل أول updateMany لمحاكاة تغيير حالة موعد بين القراءة والكتابة.
  beforeFirstUpdate: null as null | (() => void),
}));

const notify = vi.hoisted(() => ({ calls: [] as any[] }));
const dental = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock("../src/lib/prisma", () => {
  const matchIn = (v: any, cond: any) => (cond?.in ? cond.in.includes(v) : cond === undefined || cond === v);
  const appointment = {
    findMany: async ({ where }: any) =>
      db.appointments
        .filter((a) => a.doctorId === where.doctorId && matchIn(a.status, where.status) && (!where.date?.gte || a.date >= where.date.gte))
        .map((a) => ({ id: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime, patient: a.patient })),
    updateMany: async ({ where, data }: any) => {
      if (db.beforeFirstUpdate) {
        const hook = db.beforeFirstUpdate;
        db.beforeFirstUpdate = null;
        hook();
      }
      let count = 0;
      for (const a of db.appointments) {
        if (matchIn(a.id, where.id) && matchIn(a.status, where.status)) {
          a.status = data.status;
          count++;
        }
      }
      return { count };
    },
  };
  const doctorSchedule = {
    findMany: async ({ where }: any) =>
      db.schedules.filter((s) => s.doctorId === where.doctorId && (where.isException === undefined || s.isException === where.isException)),
    findUnique: async () => null,
    findFirst: async ({ where }: any) =>
      db.schedules.find(
        (s) =>
          s.doctorId === where.doctorId &&
          s.isException === where.isException &&
          s.isOff === where.isOff &&
          s.exceptionDate?.getTime() === where.exceptionDate?.getTime()
      ) ?? null,
    deleteMany: async ({ where }: any) => {
      db.schedules = db.schedules.filter((s) => !(s.doctorId === where.doctorId && s.isException === where.isException));
      return { count: 0 };
    },
    createMany: async ({ data }: any) => {
      for (const d of data) db.schedules.push({ id: `s${db.schedules.length + 1}`, isException: false, exceptionDate: null, isOff: false, ...d });
      return { count: data.length };
    },
    create: async ({ data }: any) => {
      const row = { id: `s${db.schedules.length + 1}`, dayOfWeek: null, ...data };
      db.schedules.push(row);
      return row;
    },
  };
  const client: any = {
    appointment,
    doctorSchedule,
    doctor: { findUnique: async ({ where }: any) => (where.userId === "doc-user" ? { id: "doc1", userId: "doc-user" } : null) },
    $queryRaw: async () => [],
    $transaction: async (arg: any) => (typeof arg === "function" ? arg(client) : Promise.all(arg)),
  };
  return { prisma: client };
});

vi.mock("../src/modules/notifications/notifications.service", () => ({
  createNotification: async (...args: any[]) => {
    notify.calls.push(args);
    return {};
  },
}));

vi.mock("../src/lib/dentalFollowUpSync", () => ({
  syncDentalFollowUpsSafe: async (...args: any[]) => {
    dental.calls.push(args);
  },
}));

const { addScheduleException, replaceWeeklySchedule } = await import("../src/modules/doctors/doctorSelf.service");

// يوم مستقبلي بعيد عن «اليوم» حتى لا يتأثر الاختبار بالتوقيت.
const DAY = new Date(Date.now() + 10 * 86400000);
const DAY_STR = DAY.toISOString().slice(0, 10);
const DAY_DATE = new Date(DAY_STR + "T00:00:00Z");
const OTHER_DAY_DATE = new Date(DAY_DATE.getTime() + 86400000);

function appt(id: string, status: AppointmentStatus, opts: Partial<Row> = {}): Row {
  return { id, doctorId: "doc1", date: DAY_DATE, startTime: "10:00", endTime: "10:20", status, patient: { userId: `u-${id}` }, ...opts };
}

function statusOf(id: string) {
  return db.appointments.find((a) => a.id === id)!.status;
}

beforeEach(() => {
  notify.calls = [];
  dental.calls = [];
  db.beforeFirstUpdate = null;
  // جدول أسبوعي يغطي كل الأيام 08:00–17:00.
  db.schedules = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    id: `w${d}`, doctorId: "doc1", dayOfWeek: d, startTime: "08:00", endTime: "17:00", isException: false, exceptionDate: null, isOff: false,
  }));
  db.appointments = [
    appt("p", AppointmentStatus.PENDING),
    appt("c", AppointmentStatus.CONFIRMED, { startTime: "11:00", endTime: "11:20" }),
    appt("late", AppointmentStatus.LATE),
    appt("inp", AppointmentStatus.IN_PROGRESS),
    appt("done", AppointmentStatus.COMPLETED),
    appt("cx", AppointmentStatus.CANCELLED),
    appt("ns", AppointmentStatus.NO_SHOW),
    appt("otherDay", AppointmentStatus.CONFIRMED, { date: OTHER_DAY_DATE }),
    appt("otherDoc", AppointmentStatus.CONFIRMED, { doctorId: "doc2" }),
  ];
});

describe("عطلة يوم كامل = إلغاء نهائي", () => {
  it("بلا تأكيد: 409 بلا أي تغيير، وتفاصيل دنيا بلا بيانات مريض", async () => {
    const err: any = await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }).catch((e) => e);
    expect(err.statusCode ?? err.status).toBe(409);
    const details = err.details;
    expect(details.affectedCount).toBe(2);
    for (const a of details.appointments) expect(Object.keys(a).sort()).toEqual(["date", "id", "startTime"]);
    expect(JSON.stringify(details)).not.toMatch(/u-p|u-c|userId|patient|phone|name|notes/);
    expect(statusOf("p")).toBe(AppointmentStatus.PENDING);
    expect(statusOf("c")).toBe(AppointmentStatus.CONFIRMED);
    expect(notify.calls).toHaveLength(0);
  });

  it("مع التأكيد: تُلغى PENDING/CONFIRMED في اليوم والطبيب فقط، ولا يُمس غيرها", async () => {
    const result = await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }, true);
    expect(result.affectedAppointments).toBe(2);
    expect(statusOf("p")).toBe(AppointmentStatus.CANCELLED);
    expect(statusOf("c")).toBe(AppointmentStatus.CANCELLED);
    expect(statusOf("late")).toBe(AppointmentStatus.LATE);
    expect(statusOf("inp")).toBe(AppointmentStatus.IN_PROGRESS);
    expect(statusOf("done")).toBe(AppointmentStatus.COMPLETED);
    expect(statusOf("ns")).toBe(AppointmentStatus.NO_SHOW);
    expect(statusOf("otherDay")).toBe(AppointmentStatus.CONFIRMED);
    expect(statusOf("otherDoc")).toBe(AppointmentStatus.CONFIRMED);
  });

  it("إشعار APPOINTMENT_CANCELLED برابط آمن، مرة واحدة لكل موعد أُلغي فعلًا", async () => {
    await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }, true);
    expect(notify.calls.map((c) => c[0]).sort()).toEqual(["u-c", "u-p"]);
    for (const c of notify.calls) {
      expect(c[1]).toBe("APPOINTMENT_CANCELLED");
      expect(c[1]).not.toBe("APPOINTMENT_RESCHEDULE_REQUIRED");
      expect(c[4]).toMatch(/^\/account\?appointment=[a-z]+$/);
    }
    expect(dental.calls).toEqual([[["p", "c"], "CANCELLED"]]);
  });

  it("إعادة الطلب لا تكرر الإشعار ولا تغيّر موعدًا محسومًا", async () => {
    await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }, true);
    notify.calls = [];
    const again = await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }, true);
    expect(again.affectedAppointments).toBe(0);
    expect(notify.calls).toHaveLength(0);
  });

  it("إعادة طلب عطلة نفس اليوم لا تنشئ سجل عطلة ثانيًا (حذف العطلة لاحقًا يفتح اليوم فعلًا)", async () => {
    const first = await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }, true);
    const again = await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }, true);
    const offRows = db.schedules.filter(
      (s) => s.isException && s.isOff && s.exceptionDate?.getTime() === DAY_DATE.getTime()
    );
    expect(offRows).toHaveLength(1);
    expect(again.schedule.id).toBe(first.schedule.id);
  });

  it("سباق: موعد قُرئ متأثرًا ثم لم يعد نشطًا لحظة الكتابة — لا يتغير ولا يُحتسب ولا يُشعَر", async () => {
    db.beforeFirstUpdate = () => {
      db.appointments.find((a) => a.id === "c")!.status = AppointmentStatus.IN_PROGRESS;
    };
    const result = await addScheduleException("doc-user", { exceptionDate: DAY_STR, isOff: true }, true);
    expect(statusOf("c")).toBe(AppointmentStatus.IN_PROGRESS);
    expect(statusOf("p")).toBe(AppointmentStatus.CANCELLED);
    expect(result.affectedAppointments).toBe(1);
    expect(notify.calls.map((c) => c[0])).toEqual(["u-p"]);
    expect(dental.calls).toEqual([[["p"], "CANCELLED"]]);
  });
});

describe("ساعات جزئية أو جدول أسبوعي = إعادة جدولة لا إلغاء", () => {
  it("استثناء بساعات جزئية يحوّل المتأثر إلى RESCHEDULE_REQUIRED", async () => {
    // الاستثناء الجزئي يُضاف إلى الجدول الأسبوعي (اتحاد)، فنجعل هذا اليوم بلا جدول أسبوعي ليظهر أثره.
    db.schedules = db.schedules.filter((s) => s.dayOfWeek !== DAY_DATE.getUTCDay());
    const result = await addScheduleException(
      "doc-user",
      { exceptionDate: DAY_STR, isOff: false, startTime: "10:30", endTime: "17:00" },
      true
    );
    expect(result.affectedAppointments).toBe(1);
    expect(statusOf("p")).toBe(AppointmentStatus.RESCHEDULE_REQUIRED);
    expect(statusOf("c")).toBe(AppointmentStatus.CONFIRMED);
    expect(statusOf("late")).toBe(AppointmentStatus.LATE);
    expect(notify.calls.map((c) => [c[0], c[1]])).toEqual([["u-p", "APPOINTMENT_RESCHEDULE_REQUIRED"]]);
    expect(dental.calls).toHaveLength(0);
  });

  it("تغيير الجدول الأسبوعي يحوّل المتأثر إلى RESCHEDULE_REQUIRED لا CANCELLED", async () => {
    const blocks = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "10:30", endTime: "17:00" }));
    const result = await replaceWeeklySchedule("doc-user", blocks, true);
    expect(statusOf("p")).toBe(AppointmentStatus.RESCHEDULE_REQUIRED);
    expect(statusOf("otherDay")).toBe(AppointmentStatus.RESCHEDULE_REQUIRED);
    expect(statusOf("c")).toBe(AppointmentStatus.CONFIRMED);
    expect(statusOf("late")).toBe(AppointmentStatus.LATE);
    expect(statusOf("otherDoc")).toBe(AppointmentStatus.CONFIRMED);
    expect(result.affectedAppointments).toBe(2);
    expect(notify.calls.every((c) => c[1] === "APPOINTMENT_RESCHEDULE_REQUIRED")).toBe(true);
  });

  it("سباق في الجدول الأسبوعي: لا إشعار لموعد لم يتغير", async () => {
    db.beforeFirstUpdate = () => {
      db.appointments.find((a) => a.id === "p")!.status = AppointmentStatus.CANCELLED;
    };
    const blocks = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "10:30", endTime: "17:00" }));
    const result = await replaceWeeklySchedule("doc-user", blocks, true);
    expect(statusOf("p")).toBe(AppointmentStatus.CANCELLED);
    expect(result.affectedAppointments).toBe(1);
    expect(notify.calls.map((c) => c[0])).toEqual(["u-otherDay"]);
  });
});

