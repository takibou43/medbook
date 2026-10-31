import assert from "node:assert/strict";
import test from "node:test";
import {
  canArriveLate, matchesAppointmentView, scheduleError, activePreset, algeriaToday, appointmentActions, appointmentsLink, doctorsCountAr, formatDayAr, monthRange,
  parseAppointmentFilters, presetRange, relativeDayAr, serializeAppointmentFilters, weekRange,
} from "../src/lib/doctorUi.ts";

// الجمعة 2 أكتوبر 2026، 13:00 بتوقيت الجزائر (12:00 UTC).
const NOW = Date.UTC(2026, 9, 2, 12, 0);
const iso = (day: string) => `${day}T00:00:00.000Z`;

test("late arrival is a today-only action, separate from historical records", () => {
  assert.equal(canArriveLate({status:"NO_SHOW",date:iso("2026-10-02")}, NOW),true);
  assert.equal(canArriveLate({status:"NO_SHOW",date:iso("2026-10-01")}, NOW),false);
  assert.equal(canArriveLate({status:"NO_SHOW",date:iso("2026-10-03")}, NOW),false);
});
test("appointment sections distinguish final, upcoming and actionable records", () => {
  assert.equal(matchesAppointmentView({status:"COMPLETED",date:iso("2026-10-02")},"upcoming",NOW),false);
  assert.equal(matchesAppointmentView({status:"RESCHEDULE_REQUIRED",date:iso("2026-10-03")},"action",NOW),true);
  assert.equal(matchesAppointmentView({status:"CONFIRMED",date:iso("2026-10-01")},"past",NOW),true);
  const f=parseAppointmentFilters('?tab=list&view=past&page=3&q=Sara');
  assert.deepEqual(parseAppointmentFilters(serializeAppointmentFilters(f)),f);
  assert.equal(parseAppointmentFilters('?page=Infinity').page,undefined);
});
test("weekly intervals reject invalid times, reversed periods and overlap; allow breaks", () => {
  const b={dayOfWeek:1,startTime:'08:00',endTime:'12:00'};
  assert.equal(scheduleError([b,{...b,startTime:'13:00',endTime:'17:00'}]),null);
  assert.ok(scheduleError([b,{...b,startTime:'11:00',endTime:'13:00'}]));
  assert.ok(scheduleError([{...b,endTime:'07:00'}]));
  assert.ok(scheduleError([{...b,startTime:'25:00'}]));
  assert.equal(scheduleError([b,{...b,dayOfWeek:2}]),null);
});

test("today and day boundaries follow Algeria time", () => {
  assert.equal(algeriaToday(NOW), "2026-10-02");
  assert.equal(algeriaToday(Date.UTC(2026, 9, 1, 23, 30)), "2026-10-02");
  assert.equal(algeriaToday(Date.UTC(2026, 9, 1, 22, 59)), "2026-10-01");
});

test("month card range covers the whole calendar month", () => {
  assert.deepEqual(monthRange(NOW), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(monthRange(Date.UTC(2028, 1, 10)), { from: "2028-02-01", to: "2028-02-29" });
  // 31 ديسمبر 23:30 UTC = 1 جانفي في الجزائر
  assert.deepEqual(monthRange(Date.UTC(2026, 11, 31, 23, 30)), { from: "2027-01-01", to: "2027-01-31" });
});

test("week is Saturday to Friday", () => {
  assert.deepEqual(weekRange(NOW), { from: "2026-09-26", to: "2026-10-02" });
  assert.deepEqual(weekRange(Date.UTC(2026, 9, 3, 10)), { from: "2026-10-03", to: "2026-10-09" });
  assert.equal(activePreset("2026-10-01", "2026-10-31", NOW), "month");
  assert.equal(activePreset("2026-10-02", "2026-10-02", NOW), "today");
  assert.equal(activePreset("2026-10-02", "2026-10-05", NOW), null);
  assert.deepEqual(presetRange("today", NOW), { from: "2026-10-02", to: "2026-10-02" });
});

test("Arabic date formatting is uniform (no jj/mm/aaaa)", () => {
  assert.equal(formatDayAr("2026-10-02"), "الجمعة 2 أكتوبر 2026");
  assert.equal(formatDayAr("2026-11-15", { weekday: false }), "15 نوفمبر 2026");
  assert.equal(relativeDayAr("2026-10-03", NOW), "غدًا");
  assert.equal(relativeDayAr("2026-11-15", NOW), "الأحد 15 نوفمبر");
});

test("plain «المواعيد» entry shows today's appointments (merged «جدول اليوم»)", () => {
  assert.deepEqual(parseAppointmentFilters("", NOW), { tab: "list", status: "ALL", from: "2026-10-02", to: "2026-10-02", q: "" });
  assert.deepEqual(parseAppointmentFilters("?tab=list", NOW).from, "2026-10-02");
  assert.equal(parseAppointmentFilters("?tab=queue", NOW).tab, "queue");
});

test("«كل التواريخ» stays explicit and status-only links keep all dates", () => {
  const all = { tab: "list" as const, status: "ALL" as const, from: undefined, to: undefined, q: "" };
  assert.equal(serializeAppointmentFilters(all).get("period"), "all");
  assert.deepEqual(parseAppointmentFilters(serializeAppointmentFilters(all), NOW), all);
  const completed = parseAppointmentFilters("?status=COMPLETED", NOW);
  assert.deepEqual([completed.from, completed.to], [undefined, undefined]);
  const other = parseAppointmentFilters("?tab=list&from=2026-09-20&to=2026-09-20", NOW);
  assert.deepEqual([other.from, other.to], ["2026-09-20", "2026-09-20"]);
});

test("explicit filters from stat cards open the list and are kept", () => {
  const f = parseAppointmentFilters("?status=CANCELLED");
  assert.equal(f.tab, "list");
  assert.equal(f.status, "CANCELLED");
  const legacy = parseAppointmentFilters("?status=ALL&date=2026-10-02");
  assert.deepEqual([legacy.tab, legacy.status, legacy.from, legacy.to], ["list", "ALL", "2026-10-02", "2026-10-02"]);
  const month = parseAppointmentFilters(new URL("http://x" + appointmentsLink(monthRange(NOW))).search);
  assert.deepEqual([month.tab, month.status, month.from, month.to], ["list", "ALL", "2026-10-01", "2026-10-31"]);
  assert.equal(parseAppointmentFilters("?status=HACK&from=bad").status, "ALL");
  assert.equal(parseAppointmentFilters("?status=HACK&from=bad").from, undefined);
});

test("filters round-trip through the URL (search kept while paging/navigating)", () => {
  const f = { tab: "list" as const, status: "COMPLETED" as const, from: "2026-10-01", to: "2026-10-31", q: "سارة" };
  assert.deepEqual(parseAppointmentFilters(serializeAppointmentFilters(f)), f);
});

test("no «حضر»/«لم يحضر» for tomorrow's appointments — a note instead", () => {
  const a = appointmentActions({ status: "CONFIRMED", date: iso("2026-10-03"), startTime: "09:00" }, "DOCTOR", NOW);
  assert.equal(a.complete.visible, false);
  assert.equal(a.noShow.visible, false);
  assert.match(a.note ?? "", /يوم الموعد/);
});

test("today before start: complete and no-show both disabled with a reason", () => {
  const a = appointmentActions({ status: "CONFIRMED", date: iso("2026-10-02"), startTime: "15:30" }, "DOCTOR", NOW);
  assert.deepEqual([a.complete.visible, a.complete.enabled], [true, false]);
  assert.match(a.complete.reason ?? "", /15:30/);
  assert.deepEqual([a.noShow.visible, a.noShow.enabled], [true, false]);
  assert.match(a.noShow.reason ?? "", /15:30/);
  const after = appointmentActions({ status: "CONFIRMED", date: iso("2026-10-02"), startTime: "12:30" }, "DOCTOR", NOW);
  assert.equal(after.noShow.enabled, true);
  assert.equal(after.complete.enabled, true);
  const called = appointmentActions({ status: "LATE", date: iso("2026-10-02"), startTime: "16:00" }, "DOCTOR", NOW);
  assert.equal(called.noShow.enabled, true);
  assert.equal(called.complete.enabled, true);
});

test("assistant never sees complete; final/pending statuses have no actions", () => {
  assert.equal(appointmentActions({ status: "CONFIRMED", date: iso("2026-10-02"), startTime: "09:00" }, "ASSISTANT", NOW).complete.visible, false);
  for (const status of ["PENDING", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULE_REQUIRED"] as const) {
    const a = appointmentActions({ status, date: iso("2026-10-02"), startTime: "09:00" }, "DOCTOR", NOW);
    assert.equal(a.complete.visible || a.noShow.visible, false, status);
  }
});

test("Arabic singular/dual/plural for doctors", () => {
  assert.equal(doctorsCountAr(1), "طبيب واحد");
  assert.equal(doctorsCountAr(2), "طبيبان");
  assert.equal(doctorsCountAr(5), "5 أطباء");
  assert.equal(doctorsCountAr(12), "12 طبيبًا");
});

test("assistant cannot change an appointment already with the doctor", () => {
 const a = appointmentActions({ status: "IN_PROGRESS", date: iso("2026-10-02"), startTime: "09:00" }, "ASSISTANT", NOW);
 assert.equal(a.complete.visible, false);
 assert.equal(a.noShow.visible, false);
});

// Same completion cases as the server guard, including Algeria midnight.
test("completion timing covers called patients, exact start and Algeria day boundaries", () => {
  const cases = [
    { day: "2026-10-02", time: "13:01", status: "CONFIRMED", now: NOW, enabled: false, visible: true },
    { day: "2026-10-02", time: "13:00", status: "CONFIRMED", now: NOW, enabled: true, visible: true },
    { day: "2026-10-02", time: "12:59", status: "CONFIRMED", now: NOW, enabled: true, visible: true },
    { day: "2026-10-02", time: "16:00", status: "IN_PROGRESS", now: NOW, enabled: true, visible: true },
    { day: "2026-10-02", time: "16:00", status: "LATE", now: NOW, enabled: true, visible: true },
    { day: "2026-10-01", time: "23:59", status: "CONFIRMED", now: NOW, enabled: true, visible: true },
    { day: "2026-10-02", time: "23:59", status: "CONFIRMED", now: Date.UTC(2026, 9, 2, 22, 58), enabled: false, visible: true },
    { day: "2026-10-02", time: "23:59", status: "CONFIRMED", now: Date.UTC(2026, 9, 2, 22, 59), enabled: true, visible: true },
    { day: "2026-10-02", time: "23:59", status: "CONFIRMED", now: Date.UTC(2026, 9, 2, 23, 0), enabled: true, visible: true },
  ] as const;
  for (const c of cases) {
    const { complete } = appointmentActions({ date: iso(c.day), startTime: c.time, status: c.status }, "DOCTOR", c.now);
    const label = JSON.stringify(c);
    assert.equal(complete.visible, c.visible, label);
    assert.equal(complete.enabled, c.enabled, label);
    if (!c.enabled) assert.ok(complete.reason?.includes(c.time), label);
    else assert.equal(complete.reason, undefined, label);
  }
  for (const status of ["CONFIRMED", "IN_PROGRESS", "LATE"] as const) {
    const actions = appointmentActions({ date: iso("2026-10-03"), startTime: "00:00", status }, "DOCTOR", Date.UTC(2026, 9, 2, 22, 59));
    assert.deepEqual(actions.complete, { visible: false, enabled: false });
    assert.ok(actions.note);
  }
});
