import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingHandledByAssistantNote, daysUntil, quickActions, subscriptionAlert, subscriptionBadge, subscriptionDetails,
  type SubscriptionSummary,
} from "../src/lib/doctorHeader.ts";

const NOW = Date.UTC(2026, 9, 11, 12, 0);
const inDays = (n: number) => new Date(NOW + n * 86400000).toISOString();
const sub = (over: Partial<SubscriptionSummary>): SubscriptionSummary => ({ kind: "ACTIVE", active: true, clinicName: null, expiresAt: null, ...over });
const ids = (a: { id: string }[]) => a.map((x) => x.id);
const base = { role: "DOCTOR", verificationStatus: "VERIFIED" as const, subscriptionActive: true };

test("«حجز موعد» يظهر للطبيب الموثّق الفعّال الذي لا مساعد له فقط", () => {
  assert.ok(ids(quickActions({ ...base, canCreateAppointments: true })).includes("book"));
  // طبيب لديه مساعد: يختفي الزر (والخادم يرفض بـ403 مهما فعلت الواجهة)
  assert.ok(!ids(quickActions({ ...base, canCreateAppointments: false })).includes("book"));
  // قيمة غير معروفة بعد (قيد التحميل): لا نُظهر زرًا قد يُرفض
  assert.ok(!ids(quickActions({ ...base, canCreateAppointments: undefined })).includes("book"));
});

test("لا زر حجز لغير الموثّق أو لمن اشتراكه غير فعّال أو للمساعد", () => {
  assert.ok(!ids(quickActions({ ...base, verificationStatus: "PENDING", canCreateAppointments: true })).includes("book"));
  assert.ok(!ids(quickActions({ ...base, subscriptionActive: false, canCreateAppointments: true })).includes("book"));
  assert.ok(!ids(quickActions({ ...base, role: "ASSISTANT", canCreateAppointments: true })).includes("book"));
});

test("بقية الإجراءات السريعة تبقى متاحة مع وجود المساعد", () => {
  const withAssistant = ids(quickActions({ ...base, canCreateAppointments: false }));
  assert.deepEqual(withAssistant, ["appointments", "queue", "patients"]);
  assert.deepEqual(ids(quickActions({ ...base, role: "ASSISTANT", canCreateAppointments: false })), ["appointments", "queue"]);
});

test("سطر التوضيح يظهر فقط حين يكون سبب غياب الزر هو المساعد", () => {
  assert.ok(bookingHandledByAssistantNote({ hasActiveAssistant: true, canCreateAppointments: false }));
  assert.equal(bookingHandledByAssistantNote({ hasActiveAssistant: false, canCreateAppointments: true }), null);
  assert.equal(bookingHandledByAssistantNote({ hasActiveAssistant: undefined, canCreateAppointments: undefined }), null);
});

test("شارة الاشتراك قصيرة وحسب الحالة الفعلية", () => {
  assert.equal(subscriptionBadge(null), null);
  assert.equal(subscriptionBadge(sub({ kind: "CLINIC", clinicName: "X" }), NOW)?.label, "ضمن اشتراك العيادة");
  assert.equal(subscriptionBadge(sub({ kind: "TRIAL", expiresAt: inDays(30) }), NOW)?.label, "تجربة مجانية");
  assert.equal(subscriptionBadge(sub({ kind: "ACTIVE", expiresAt: inDays(30) }), NOW)?.tone, "green");
  assert.equal(subscriptionBadge(sub({ kind: "EXPIRED", active: false }), NOW)?.tone, "red");
  assert.equal(subscriptionBadge(sub({ kind: "NONE", active: false }), NOW)?.label, "غير مفعّل");
  assert.equal(subscriptionBadge(sub({ kind: "CLINIC", active: false, clinicName: "X" }), NOW)?.tone, "red");
  for (const s of [sub({ kind: "CLINIC" }), sub({ kind: "TRIAL" }), sub({ kind: "ACTIVE" }), sub({ kind: "EXPIRED", active: false }), sub({ kind: "NONE", active: false })]) {
    assert.ok((subscriptionBadge(s, NOW)?.label ?? "").length <= 20, "الشارة يجب ألا تحمل نصًا طويلًا");
  }
});

test("لا نخترع مدة: بلا تاريخ لا عدّاد ولا تنبيه انتهاء", () => {
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil("غير صالح", NOW), null);
  assert.equal(subscriptionAlert(sub({ kind: "ACTIVE", expiresAt: null }), NOW), null);
  const details = subscriptionDetails(sub({ kind: "ACTIVE", expiresAt: null }), (d) => d, NOW);
  assert.ok(!details.lines.some((l) => /\d/.test(l)), "لا أرقام/تواريخ مخترعة");
});

test("تنبيه الرأس فقط عند الحاجة: منتهٍ أو يقترب الانتهاء", () => {
  assert.equal(subscriptionAlert(sub({ expiresAt: inDays(60) }), NOW), null);
  assert.ok(subscriptionAlert(sub({ expiresAt: inDays(3) }), NOW)?.includes("3"));
  assert.ok(subscriptionAlert(sub({ kind: "EXPIRED", active: false }), NOW));
  assert.equal(subscriptionBadge(sub({ expiresAt: inDays(3) }), NOW)?.tone, "amber");
});

test("اشتراك ضمن عيادة: التفاصيل توضّح ذلك ولا تعرض زر تفعيل/دفع", () => {
  const d = subscriptionDetails(sub({ kind: "CLINIC", clinicName: "عيادة الأمل", expiresAt: inDays(20) }), (x) => x, NOW);
  assert.ok(d.lines.some((l) => l.includes("عيادة الأمل")));
  assert.equal(d.needsAdminContact, false);
  assert.ok(subscriptionDetails(sub({ kind: "EXPIRED", active: false }), (x) => x, NOW).needsAdminContact);
  assert.ok(subscriptionDetails(sub({ kind: "NONE", active: false }), (x) => x, NOW).needsAdminContact);
});

test("سطر الأيام المتبقية: عدد حقيقي فقط، وصيغ عربية صحيحة", async () => {
  const { subscriptionDaysLine } = await import("../src/lib/doctorHeader.ts");
  assert.equal(subscriptionDaysLine(null, NOW), null);
  assert.deepEqual(subscriptionDaysLine(sub({ kind: "TRIAL", expiresAt: inDays(30) }), NOW), { text: "متبقٍ من الفترة التجريبية: 30 يومًا", tone: "blue" });
  assert.deepEqual(subscriptionDaysLine(sub({ kind: "ACTIVE", expiresAt: inDays(5) }), NOW), { text: "متبقٍ من اشتراكك: 5 أيام", tone: "amber" });
  assert.equal(subscriptionDaysLine(sub({ kind: "ACTIVE", expiresAt: inDays(1) }), NOW)?.text, "متبقٍ من اشتراكك: يوم واحد");
  assert.equal(subscriptionDaysLine(sub({ kind: "ACTIVE", expiresAt: inDays(2) }), NOW)?.text, "متبقٍ من اشتراكك: يومان");
  assert.equal(subscriptionDaysLine(sub({ kind: "ACTIVE", expiresAt: inDays(60) }), NOW)?.tone, "green");
  assert.equal(subscriptionDaysLine(sub({ kind: "CLINIC", expiresAt: inDays(20) }), NOW)?.text, "متبقٍ من اشتراك العيادة: 20 يومًا");
  // لا تاريخ انتهاء في السجل: لا نخترع عددًا
  assert.equal(subscriptionDaysLine(sub({ kind: "ACTIVE", expiresAt: null }), NOW)?.text, "اشتراك فعّال");
  assert.equal(subscriptionDaysLine(sub({ kind: "EXPIRED", active: false, expiresAt: inDays(-3) }), NOW)?.tone, "red");
});
