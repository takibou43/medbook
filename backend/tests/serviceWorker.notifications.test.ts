/**
 * سلوك الـService Worker (موقع المرضى + لوحة الأطباء) مع إشعارات المواعيد:
 *  - Push لموعد اليوم يُعرض بوسم الموعد appt-<id> ويحمل appointmentId/expiresAt في data.
 *  - Push لموعد انتهى يومه لا يُعرض.
 *  - عند أي Push / تفعيل / رسالة من الصفحة: تُغلق الإشعارات الظاهرة التي انتهى يوم موعدها فقط،
 *    وتبقى إشعارات الغد والإشعارات العامة.
 *  - الضغط على إشعار موعد منتهٍ يفتح الصفحة الرئيسية لا صفحة الموعد.
 * الملف الحقيقي public/sw.js يُحمَّل داخل vm مع محاكاة لـ self/registration/clients.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import vm from "vm";

type Handler = (event: any) => void;

class FakeNotification {
  closed = false;
  constructor(public title: string, public options: any) {}
  get data() { return this.options.data; }
  get tag() { return this.options.tag; }
  close() { this.closed = true; }
}

function loadSw(app: "frontend" | "frontend-doctor", nowMs: number) {
  const src = fs.readFileSync(path.resolve(__dirname, `../../${app}/public/sw.js`), "utf8");
  const handlers: Record<string, Handler[]> = {};
  let shown: FakeNotification[] = [];
  const opened: string[] = [];
  const registration = {
    showNotification: async (title: string, options: any) => {
      // نفس سلوك المتصفح: وسم مطابق يستبدل الإشعار السابق.
      shown = shown.filter((n) => n.closed || n.tag !== options.tag);
      shown.push(new FakeNotification(title, options));
    },
    getNotifications: async () => shown.filter((n) => !n.closed),
  };
  const FakeDate = class extends Date {
    static now() { return nowMs; }
  };
  const self: any = {
    registration,
    location: { origin: "https://medbook.test" },
    clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); }, claim: async () => undefined },
    addEventListener: (type: string, fn: Handler) => { (handlers[type] ??= []).push(fn); },
    skipWaiting: () => undefined,
  };
  vm.runInNewContext(src, { self, caches: { keys: async () => [], open: async () => ({}) }, fetch: async () => ({}), URL, Response, Promise, Date: FakeDate, setTimeout, console });

  async function dispatch(type: string, event: any) {
    const waits: Promise<unknown>[] = [];
    const ev = { ...event, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: () => undefined };
    for (const fn of handlers[type] ?? []) fn(ev);
    await Promise.all(waits);
  }
  const push = (payload: unknown) => dispatch("push", { data: { json: () => payload } });
  return { dispatch, push, registration, get shown() { return shown; }, set shown(v) { shown = v; }, opened, FakeNotification };
}

const NOW = Date.parse("2026-09-24T12:00:00Z"); // 13:00 بتوقيت الجزائر
const TODAY_END = "2026-09-24T23:00:00.000Z";
const TOMORROW_END = "2026-09-25T23:00:00.000Z";
const YESTERDAY_END = "2026-09-23T23:00:00.000Z";

for (const app of ["frontend", "frontend-doctor"] as const) {
  describe(`Service Worker (${app}) — إشعارات المواعيد`, () => {
    it("Push لموعد اليوم: يُعرض بوسم الموعد ويحمل appointmentId/expiresAt", async () => {
      const sw = loadSw(app, NOW);
      await sw.push({ title: "🔔 موعدك بعد 5 دقائق", body: "b", tag: "appt-A", url: "/account?appointment=A", appointmentId: "A", appointmentDate: "2026-09-24", expiresAt: TODAY_END });
      expect(sw.shown).toHaveLength(1);
      expect(sw.shown[0].tag).toBe("appt-A");
      expect(sw.shown[0].data).toMatchObject({ appointmentId: "A", appointmentDate: "2026-09-24", expiresAt: TODAY_END });
    });

    it("إشعار جديد لنفس الموعد يستبدل السابق (نفس الوسم) بدل أن يتراكم", async () => {
      const sw = loadSw(app, NOW);
      await sw.push({ title: "🔔 تذكير بموعدك", body: "1", tag: "appt-A", appointmentId: "A", expiresAt: TODAY_END });
      await sw.push({ title: "🔔 تنبيه بخصوص موعدك", body: "2", tag: "appt-A", appointmentId: "A", expiresAt: TODAY_END });
      expect(sw.shown.filter((n) => !n.closed)).toHaveLength(1);
      expect(sw.shown[0].title).toBe("🔔 تنبيه بخصوص موعدك");
    });

    it("Push لموعد انتهى يومه (وصل متأخرًا): لا يُعرض", async () => {
      const sw = loadSw(app, NOW);
      await sw.push({ title: "قديم", body: "b", tag: "appt-OLD", appointmentId: "OLD", expiresAt: YESTERDAY_END });
      expect(sw.shown).toHaveLength(0);
    });

    it("عند وصول Push جديد: يُغلق إشعار موعد الأمس فقط، ويبقى إشعار الغد والإشعار العام", async () => {
      const sw = loadSw(app, NOW);
      const old = new sw.FakeNotification("أمس", { tag: "appt-Y", data: { appointmentId: "Y", expiresAt: YESTERDAY_END } });
      const tomorrow = new sw.FakeNotification("غدًا", { tag: "appt-T", data: { appointmentId: "T", expiresAt: TOMORROW_END } });
      const general = new sw.FakeNotification("رسالة", { tag: "NEW_MESSAGE", data: { url: "/" } });
      sw.shown = [old, tomorrow, general];
      await sw.push({ title: "اليوم", body: "b", tag: "appt-A", appointmentId: "A", expiresAt: TODAY_END });
      expect(old.closed).toBe(true);
      expect(tomorrow.closed).toBe(false);
      expect(general.closed).toBe(false);
      expect(sw.shown.filter((n) => !n.closed).map((n) => n.title).sort()).toEqual(["اليوم", "رسالة", "غدًا"].sort());
    });

    it("بعد منتصف ليل الجزائر: رسالة الصفحة/تفعيل الـSW تُغلق إشعار موعد اليوم المنتهي", async () => {
      const sw = loadSw(app, Date.parse("2026-09-24T23:00:01Z")); // 00:00:01 بتوقيت الجزائر يوم 25
      const today = new sw.FakeNotification("اليوم", { tag: "appt-A", data: { appointmentId: "A", expiresAt: TODAY_END } });
      const tomorrow = new sw.FakeNotification("غدًا", { tag: "appt-T", data: { appointmentId: "T", expiresAt: TOMORROW_END } });
      sw.shown = [today, tomorrow];
      await sw.dispatch("message", { data: { type: "MB_CLOSE_EXPIRED_NOTIFICATIONS" } });
      expect(today.closed).toBe(true);
      expect(tomorrow.closed).toBe(false);

      const sw2 = loadSw(app, Date.parse("2026-09-24T23:00:01Z"));
      const t2 = new sw2.FakeNotification("اليوم", { tag: "appt-A", data: { expiresAt: TODAY_END } });
      sw2.shown = [t2];
      await sw2.dispatch("activate", {});
      expect(t2.closed).toBe(true);
    });

    it("الضغط على إشعار موعد منتهٍ يفتح الصفحة الرئيسية لا صفحة الموعد", async () => {
      const sw = loadSw(app, NOW);
      const n = new sw.FakeNotification("أمس", { data: { url: "/account?appointment=Y", expiresAt: YESTERDAY_END } });
      await sw.dispatch("notificationclick", { notification: n });
      expect(n.closed).toBe(true);
      expect(sw.opened).toEqual([app === "frontend" ? "/account" : "/"]);

      const sw2 = loadSw(app, NOW);
      const live = new sw2.FakeNotification("اليوم", { data: { url: "/account?appointment=A", expiresAt: TODAY_END } });
      await sw2.dispatch("notificationclick", { notification: live });
      expect(sw2.opened).toEqual(["/account?appointment=A"]);
    });
  });
}
