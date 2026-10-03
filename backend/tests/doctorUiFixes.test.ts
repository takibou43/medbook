import { describe, it, expect } from "vitest";
import { patientKey, summarizePatients, queryPatients, type PatientAppointmentRow } from "../src/lib/doctorPatients";
import { statusTimingError } from "../src/lib/appointmentTiming";
import { weeklyScheduleError } from "../src/lib/scheduleValidation";

describe("schedule validation before writes", () => {
  it("rejects invalid, reversed and overlapping intervals; permits breaks and adjacent slots", () => {
    const a={dayOfWeek:1,startTime:'08:00',endTime:'12:00'};
    expect(weeklyScheduleError([a,{...a,startTime:'12:00',endTime:'13:00'}])).toBeNull();
    expect(weeklyScheduleError([a,{...a,startTime:'11:59',endTime:'13:00'}])).not.toBeNull();
    expect(weeklyScheduleError([{...a,startTime:'25:00'}])).not.toBeNull();
    expect(weeklyScheduleError([{...a,endTime:'07:00'}])).not.toBeNull();
    expect(weeklyScheduleError([a,{...a,dayOfWeek:2}])).toBeNull();
  });
});

// «الآن» ثابت: 2 أكتوبر 2026 الساعة 13:00 بتوقيت الجزائر (= 12:00 UTC).
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const d = (day: string) => new Date(day + "T00:00:00Z");

let seq = 0;
function row(over: Partial<PatientAppointmentRow>): PatientAppointmentRow {
  return {
    id: `a${++seq}`,
    date: d("2026-10-02"),
    startTime: "09:00",
    status: "CONFIRMED",
    patientId: "p1",
    familyMemberId: null,
    guestFirstName: null,
    guestLastName: null,
    guestPhone: null,
    patient: { firstName: "سارة", lastName: "بن علي", user: { email: "s@x.dz", phone: "0551234567" } },
    familyMember: null,
    ...over,
  } as PatientAppointmentRow;
}
// الخادم يمرّر الصفوف مرتبة تنازليًا بالتاريخ ثم الوقت.
const desc = (rows: PatientAppointmentRow[]) =>
  [...rows].sort((a, b) => `${b.date.toISOString()}${b.startTime}`.localeCompare(`${a.date.toISOString()}${a.startTime}`));

describe("مرضاي — آخر زيارة مكتملة والموعد القادم", () => {
  it("shared guest phone never proves identity; dashboard and list share the same key", () => {
    const rows = [row({id:'guest-1',patientId:null,patient:null,guestFirstName:'Sara',guestPhone:'0551234567'}),row({id:'guest-2',patientId:null,patient:null,guestFirstName:'Ali',guestPhone:'0551234567'}),row({}),row({familyMemberId:'child-1'})];
    const list=summarizePatients(rows,NOW);
    expect(list).toHaveLength(4);
    expect(new Set(rows.map(patientKey)).size).toBe(list.length);
    expect(list.filter(p => p.isGuest).map(p => p.totalAppointments)).toEqual([1,1]);
  });
  it("موعد نوفمبر القادم لا يظهر كـ«آخر زيارة»؛ آخر زيارة = أحدث موعد COMPLETED فقط", () => {
    const [p] = summarizePatients(
      desc([
        row({ date: d("2026-11-15"), status: "CONFIRMED" }),
        row({ date: d("2026-09-20"), status: "COMPLETED" }),
        row({ date: d("2026-09-28"), status: "CANCELLED" }),
        row({ date: d("2026-09-25"), status: "NO_SHOW" }),
      ]),
      NOW
    );
    expect(p.lastCompletedVisit?.date).toBe("2026-09-20");
    expect(p.lastVisit).toBe("2026-09-20");
    expect(p.nextAppointment?.date).toBe("2026-11-15");
    expect(p.totalAppointments).toBe(4);
  });

  it("الموعد القادم = الأقرب من PENDING/CONFIRMED/LATE اعتبارًا من اليوم؛ الملغى والمواعيد الماضية لا تُحتسب", () => {
    const [p] = summarizePatients(
      desc([
        row({ date: d("2026-12-01"), status: "CONFIRMED" }),
        row({ date: d("2026-10-05"), status: "PENDING" }),
        row({ date: d("2026-10-03"), status: "CANCELLED" }),
        row({ date: d("2026-10-01"), status: "CONFIRMED" }), // أمس — ليس قادمًا
      ]),
      NOW
    );
    expect(p.nextAppointment).toMatchObject({ date: "2026-10-05", status: "PENDING" });
  });

  it("موعد اليوم المفتوح (حتى لو فات وقته وهو في الطابور) يُعد قادمًا؛ حدود اليوم بتوقيت الجزائر", () => {
    // 23:30 UTC يوم 1 أكتوبر = 00:30 يوم 2 أكتوبر في الجزائر.
    const lateNight = Date.UTC(2026, 9, 1, 23, 30);
    const [p] = summarizePatients([row({ date: d("2026-10-02"), startTime: "08:00", status: "LATE" })], lateNight);
    expect(p.nextAppointment?.date).toBe("2026-10-02");
    const [q] = summarizePatients([row({ date: d("2026-10-01"), startTime: "08:00" })], lateNight);
    expect(q.nextAppointment).toBeNull();
  });

  it("بلا بيانات: null (تعرضها الواجهة «لا توجد زيارة مكتملة» / «لا يوجد موعد قادم»)", () => {
    const [p] = summarizePatients([row({ date: d("2026-09-01"), status: "CANCELLED" })], NOW);
    expect(p.lastCompletedVisit).toBeNull();
    expect(p.lastVisit).toBeNull();
    expect(p.nextAppointment).toBeNull();
  });

  it("يميّز فرد العائلة عن صاحب الحساب، ولا يدمج الضيوف أو الأسماء المتشابهة", () => {
    const list = summarizePatients(
      desc([
        row({ id: "x1" }),
        row({ id: "x2", familyMemberId: "f1", familyMember: { id: "f1", firstName: "ياسين", lastName: "بن علي", relationship: "CHILD" } }),
        row({ id: "x3", patientId: null, patient: null, guestFirstName: "سارة", guestLastName: "بن علي", guestPhone: "0551234567" }),
        row({ id: "x4", patientId: "p2", patient: { firstName: "سارة", lastName: "بن علي", user: { email: null, phone: "0551234567" } } }),
      ]),
      NOW
    );
    expect(list).toHaveLength(4);
    const child = list.find((p) => p.familyMemberId === "f1")!;
    expect(child.firstName).toBe("ياسين");
    expect(child.accountHolderName).toBe("سارة بن علي");
    expect(list.find((p) => p.isGuest)?.lastAppointmentId).toBeNull();
  });
});

describe("مرضاي — بحث وفرز وتقسيم صفحات", () => {
  const many = summarizePatients(
    Array.from({ length: 60 }, (_, i) =>
      row({
        id: `m${i}`,
        patientId: `pp${i}`,
        status: i % 2 ? "COMPLETED" : "CONFIRMED",
        date: d(i % 2 ? `2026-09-${String((i % 28) + 1).padStart(2, "0")}` : "2026-10-10"),
        patient: { firstName: `مريض${i}`, lastName: "أحمد", user: { email: null, phone: `05500000${String(i).padStart(2, "0")}` } },
      })
    ),
    NOW
  );

  it("الصفحة الأولى 25 افتراضيًا مع العدد الكلي", () => {
    const page = queryPatients(many, {});
    expect(page.items).toHaveLength(25);
    expect(page).toMatchObject({ total: 60, page: 1, pageSize: 25, totalPages: 3 });
    expect(queryPatients(many, { page: 3 }).items).toHaveLength(10);
    expect(queryPatients(many, { page: 99 }).page).toBe(3);
  });

  it("بحث بالهاتف وبالاسم (مع تطبيع الهمزة)", () => {
    expect(queryPatients(many, { q: "0550000042" }).items.map((p) => p.patientId)).toEqual(["pp42"]);
    expect(queryPatients(many, { q: "مريض7 احمد" }).total).toBe(1);
  });

  it("فرز «الأحدث زيارة» يضع من لا زيارة مكتملة له في الأسفل، و«الموعد القادم» الأقرب أولًا", () => {
    const recent = queryPatients(many, { pageSize: 100 }).items;
    expect(recent[0].lastCompletedVisit).not.toBeNull();
    expect(recent[recent.length - 1].lastCompletedVisit).toBeNull();
    const next = queryPatients(many, { sort: "next", pageSize: 100 }).items;
    expect(next[0].nextAppointment?.date).toBe("2026-10-10");
    expect(next[next.length - 1].nextAppointment).toBeNull();
  });
});

describe("قيود توقيت حالات الموعد", () => {
  const appt = (day: string, startTime: string, status: any = "CONFIRMED") => ({ date: d(day), startTime, status });

  it("«لم يحضر» مرفوض قبل وقت الموعد (الغد، أو اليوم قبل الساعة)، ومقبول بعده", () => {
    expect(statusTimingError(appt("2026-10-03", "09:00"), "NO_SHOW", NOW)).toMatch(/قبل حلول وقت الموعد/);
    expect(statusTimingError(appt("2026-10-02", "15:00"), "NO_SHOW", NOW)).toMatch(/15:00/);
    expect(statusTimingError(appt("2026-10-02", "12:30"), "NO_SHOW", NOW)).toBeNull();
    expect(statusTimingError(appt("2026-09-30", "12:30"), "NO_SHOW", NOW)).toBeNull();
  });

  it("مريض نودي عليه اليوم (IN_PROGRESS/LATE) يمكن تسجيل غيابه حتى قبل وقته المجدول", () => {
    expect(statusTimingError(appt("2026-10-02", "16:00", "LATE"), "NO_SHOW", NOW)).toBeNull();
    expect(statusTimingError(appt("2026-10-02", "16:00", "IN_PROGRESS"), "NO_SHOW", NOW)).toBeNull();
  });

  it("لا إنهاء ولا إدخال لموعد يومه لم يأتِ؛ إنهاء موعد اليوم قبل وقته مسموح (دخل مبكرًا)", () => {
    expect(statusTimingError(appt("2026-10-03", "09:00"), "COMPLETED", NOW)).toMatch(/لم يحن يومه/);
    expect(statusTimingError(appt("2026-10-02", "16:00"), "COMPLETED", NOW)).toBeNull();
    expect(statusTimingError(appt("2026-10-03", "09:00"), "IN_PROGRESS", NOW)).toMatch(/يوم لاحق/);
    expect(statusTimingError(appt("2026-09-28", "09:00", "NO_SHOW"), "IN_PROGRESS", NOW)).toMatch(/يوم سابق/);
    expect(statusTimingError(appt("2026-10-02", "09:00", "NO_SHOW"), "IN_PROGRESS", NOW)).toBeNull();
  });

  it("الإلغاء والتأكيد غير مقيّدين بالتوقيت", () => {
    expect(statusTimingError(appt("2026-11-03", "09:00"), "CANCELLED", NOW)).toBeNull();
    expect(statusTimingError(appt("2026-11-03", "09:00", "PENDING"), "CONFIRMED", NOW)).toBeNull();
  });

  it("حدّ اليوم: 23:30 UTC = منتصف ليل الجزائر التالي", () => {
    const lateNight = Date.UTC(2026, 9, 1, 23, 30); // 00:30 يوم 2 أكتوبر بالجزائر
    expect(statusTimingError(appt("2026-10-02", "00:15"), "NO_SHOW", lateNight)).toBeNull();
    expect(statusTimingError(appt("2026-10-02", "09:00"), "IN_PROGRESS", lateNight)).toBeNull();
  });
});
