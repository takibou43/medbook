/**
 * تنبيه «موعدك مع الطبيب بعد 5 دقائق» في الـService Worker الحقيقي لموقع المرضى (frontend/public/sw.js)
 * + وحدة الرنة داخل الصفحة (frontend/src/lib/appointmentAlarm.ts) + ملف الرنة نفسه.
 * الـSW يُحمَّل داخل vm مع محاكاة لـ self/registration/clients/caches. caches دائم بين "إعادات التشغيل"
 * (كما في المتصفح)، فتحميل الملف من جديد يحاكي إعادة تشغيل الـService Worker.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import vm from "vm";

type Handler = (event: any) => void;
const NOW = Date.parse("2026-09-24T12:00:00Z");
const TODAY_END = "2026-09-24T23:00:00.000Z";
const YESTERDAY_END = "2026-09-23T23:00:00.000Z";

class FakeCaches {
  stores = new Map<string, Map<string, Response>>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const m = this.stores.get(name)!;
    const key = (r: any) => (typeof r === "string" ? r : r.url);
    return {
      match: async (r: any) => m.get(key(r))?.clone(),
      put: async (r: any, res: Response) => void m.set(key(r), res),
      delete: async (r: any) => m.delete(key(r)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      add: async () => undefined,
    };
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match() {
    return undefined;
  }
}

function loadSw(app: "frontend" | "frontend-doctor", caches: FakeCaches, shownStore: { list: any[] }, messages: any[]) {
  const src = fs.readFileSync(path.resolve(__dirname, `../../${app}/public/sw.js`), "utf8");
  const handlers: Record<string, Handler[]> = {};
  const registration = {
    showNotification: async (title: string, options: any) => {
      shownStore.list = shownStore.list.filter((n) => n.options.tag !== options.tag);
      shownStore.list.push({ title, options, close() { shownStore.list = shownStore.list.filter((x) => x !== this); } });
    },
    getNotifications: async () => shownStore.list.map((n) => ({ ...n, data: n.options.data, close: n.close.bind(n) })),
  };
  const FakeDate = class extends Date {
    static now() { return NOW; }
  };
  const client = { url: "https://medbook.test/account", postMessage: (m: any) => messages.push(m) };
  const self: any = {
    registration,
    location: { origin: "https://medbook.test" },
    clients: { matchAll: async () => [client], openWindow: async () => undefined, claim: async () => undefined },
    addEventListener: (type: string, fn: Handler) => { (handlers[type] ??= []).push(fn); },
    skipWaiting: () => undefined,
  };
  vm.runInNewContext(src, { self, caches, fetch: async () => ({}), URL, Response, Promise, Date: FakeDate, setTimeout, console, JSON, encodeURIComponent });
  async function dispatch(type: string, event: any) {
    const waits: Promise<unknown>[] = [];
    const ev = { ...event, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: () => undefined };
    for (const fn of handlers[type] ?? []) fn(ev);
    await Promise.all(waits);
  }
  return { dispatch, push: (payload: unknown) => dispatch("push", { data: { json: () => payload } }) };
}

const alarm = (id = "A", extra: Record<string, unknown> = {}) => ({
  title: "موعدك مع الطبيب بعد 5 دقائق",
  body: "لديك موعد مع د. أحمد بن علي على الساعة 13:05.",
  url: `/account?appointment=${id}`,
  tag: `appt-${id}`,
  appointmentId: id,
  appointmentDate: "2026-09-24",
  expiresAt: TODAY_END,
  kind: "APPOINTMENT_5MIN_ALARM",
  deliverBy: "2026-09-24T12:05:00.000Z",
  urgency: "high",
  ...extra,
});

describe("Service Worker (موقع المرضى) — تنبيه الخمس دقائق", () => {
  let caches: FakeCaches;
  let shown: { list: any[] };
  let messages: any[];
  beforeEach(() => {
    caches = new FakeCaches();
    shown = { list: [] };
    messages = [];
  });

  it("يعرض الإشعار بالنص المطلوب وبنمط المنبّه (اهتزاز مميّز، يبقى ظاهرًا، ينبّه من جديد)", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm());
    expect(shown.list).toHaveLength(1);
    const n = shown.list[0];
    expect(n.title).toBe("موعدك مع الطبيب بعد 5 دقائق");
    expect(n.options).toMatchObject({ tag: "appt-A", renotify: true, requireInteraction: true, silent: false, dir: "rtl" });
    expect(n.options.vibrate).toEqual([700, 250, 700, 250, 700, 250, 1400]);
    expect(n.options.data).toMatchObject({ kind: "APPOINTMENT_5MIN_ALARM", appointmentId: "A", expiresAt: TODAY_END });
  });

  it("يرسل رسالة إلى الصفحة المفتوحة لتشغيل الرنة الخاصة (مرة واحدة)", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm());
    expect(messages).toEqual([{ type: "MB_APPOINTMENT_ALARM", kind: "APPOINTMENT_5MIN_ALARM", appointmentId: "A", title: "موعدك مع الطبيب بعد 5 دقائق", body: alarm().body }]);
  });

  // ===== «دورك اقترب» =====
  const approach = (id = "A") =>
    alarm(id, {
      title: "دورك اقترب",
      body: "دورك اقترب، يرجى الاستعداد والتوجه إلى الطبيب.",
      url: `/status/${id}`,
      kind: "QUEUE_APPROACH_ALARM",
    });

  it("«دورك اقترب»: نفس نمط المنبّه (اهتزاز مميّز + يبقى ظاهرًا + رسالة الرنة للصفحة)", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push(approach());
    expect(shown.list).toHaveLength(1);
    expect(shown.list[0].title).toBe("دورك اقترب");
    expect(shown.list[0].options).toMatchObject({ requireInteraction: true, renotify: true, silent: false });
    expect(shown.list[0].options.vibrate).toEqual([700, 250, 700, 250, 700, 250, 1400]);
    expect(shown.list[0].options.data.kind).toBe("QUEUE_APPROACH_ALARM");
    expect(messages).toEqual([{ type: "MB_APPOINTMENT_ALARM", kind: "QUEUE_APPROACH_ALARM", appointmentId: "A", title: "دورك اقترب", body: approach().body }]);
  });

  it("«دورك اقترب» مكرر (إعادة تسليم أو إعادة تشغيل الـSW) لا يعرض ولا يرنّ ثانية، ومستقل عن تنبيه الخمس دقائق", async () => {
    let sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm());
    await sw.push(approach());
    expect(messages.map((m) => m.kind)).toEqual(["APPOINTMENT_5MIN_ALARM", "QUEUE_APPROACH_ALARM"]);
    sw = loadSw("frontend", caches, shown, messages); // إعادة تشغيل الـService Worker
    await sw.push(approach());
    await sw.push(alarm());
    expect(messages).toHaveLength(2);
  });

  it("تسليم مكرر لنفس الموعد لا يعرض إشعارًا ثانيًا ولا يرنّ ثانية — حتى بعد إغلاق الإشعار", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm());
    shown.list[0].close();
    await sw.push(alarm());
    expect(shown.list).toHaveLength(0);
    expect(messages).toHaveLength(1);
  });

  it("لا يتكرر بعد إعادة تشغيل الـService Worker (السجل في Cache Storage الدائم)، ولا بعد تفعيل نسخة جديدة", async () => {
    let sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm());
    shown.list = [];
    sw = loadSw("frontend", caches, shown, messages); // إعادة تشغيل
    await sw.dispatch("activate", {});
    await sw.push(alarm());
    expect(shown.list).toHaveLength(0);
    expect(messages).toHaveLength(1);
    expect(caches.stores.has("medbook-alarms")).toBe(true);
  });

  it("موعد آخر يُنبَّه له بشكل مستقل", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm("A"));
    await sw.push(alarm("B"));
    expect(shown.list.map((n) => n.options.tag).sort()).toEqual(["appt-A", "appt-B"]);
    expect(messages).toHaveLength(2);
  });

  it("تنبيه لموعد انتهى يومه لا يُعرض", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm("A", { expiresAt: YESTERDAY_END }));
    expect(shown.list).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it("الإشعارات الأخرى (تذكير الساعة وغيره) بلا أي تغيير: بلا اهتزاز خاص ولا requireInteraction ولا رسالة رنة", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push({ title: "🔔 تذكير بموعدك", body: "b", tag: "appt-A", appointmentId: "A", expiresAt: TODAY_END });
    await sw.push({ title: "تم تأكيد موعدك", body: "b", tag: "appt-C", appointmentId: "C", expiresAt: TODAY_END });
    for (const n of shown.list) {
      expect(n.options.vibrate).toBeUndefined();
      expect(n.options.requireInteraction).toBeUndefined();
      expect(n.options.data.kind).toBeUndefined();
      expect(n.options.renotify).toBe(true);
    }
    expect(messages).toHaveLength(0);
  });

  it("تذكير الساعة ثم تنبيه الخمس دقائق على نفس الموعد: التنبيه يستبدل التذكير (إشعار واحد ظاهر) وينبّه", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push({ title: "🔔 تذكير بموعدك", body: "b", tag: "appt-A", appointmentId: "A", expiresAt: TODAY_END });
    await sw.push(alarm("A"));
    expect(shown.list).toHaveLength(1);
    expect(shown.list[0].options.requireInteraction).toBe(true);
  });

  it("سجلات التنبيه المنتهية تُحذف عند التفعيل (لا تتراكم)", async () => {
    const sw = loadSw("frontend", caches, shown, messages);
    await sw.push(alarm("OLD", { expiresAt: TODAY_END }));
    const store = caches.stores.get("medbook-alarms")!;
    store.set("/__mb-alarm/OLD2", new Response(JSON.stringify({ expiresAt: YESTERDAY_END })));
    await sw.dispatch("activate", {});
    expect([...store.keys()]).toEqual(["/__mb-alarm/OLD"]);
  });

  it("لوحة الأطباء لم تتغيّر: لا منطق منبّه في sw.js الخاص بها", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../frontend-doctor/public/sw.js"), "utf8");
    expect(src).not.toContain("APPOINTMENT_5MIN_ALARM");
  });
});

describe("ملف الرنة الخاصة", () => {
  const file = path.resolve(__dirname, "../../frontend/public/sounds/appointment-alarm.wav");

  it("موجود، WAV صالح، ~3 ثوانٍ فقط (تنبيه واضح لا رنين بلا توقف)", () => {
    const buf = fs.readFileSync(file);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
    const sampleRate = buf.readUInt32LE(24);
    const byteRate = buf.readUInt32LE(28);
    const dataSize = buf.length - 44;
    const seconds = dataSize / byteRate;
    expect(sampleRate).toBe(22050);
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(5);
  });

  it("لا يستعمله أي إشعار آخر في المشروع", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("appointment-alarm.wav")) hits.push(path.relative(path.resolve(__dirname, "../.."), p));
      }
    };
    for (const d of ["frontend/src", "frontend/public", "frontend-doctor/src", "frontend-doctor/public"]) walk(path.resolve(__dirname, "../..", d));
    expect(hits).toEqual([path.join("frontend", "src", "lib", "appointmentAlarm.ts")]);
  });
});

describe("وحدة الرنة داخل الصفحة (appointmentAlarm.ts)", () => {
  it("رنة واحدة لكل موعد على هذا الجهاز، ولا تُعاد بعد إعادة تحميل الصفحة", async () => {
    const store = new Map<string, string>();
    (globalThis as any).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    };
    const mod = await import("../../frontend/src/lib/appointmentAlarm");
    expect(mod.isAlarmMessage({ type: "MB_APPOINTMENT_ALARM", appointmentId: "A" })).toBe(true);
    expect(mod.isAlarmMessage({ type: "OTHER" })).toBe(false);
    expect(mod.claimAlarmPlayback("A")).toBe(true);
    expect(mod.claimAlarmPlayback("A")).toBe(false);
    expect(mod.claimAlarmPlayback("B")).toBe(true);
    // «دورك اقترب» لنفس الموعد له مفتاح مستقل: يرنّ مرة واحدة فقط أيضًا.
    expect(mod.claimAlarmPlayback("A", "QUEUE_APPROACH_ALARM")).toBe(true);
    expect(mod.claimAlarmPlayback("A", "QUEUE_APPROACH_ALARM")).toBe(false);
    expect(JSON.parse(store.get("mb-alarm-played")!)).toEqual(["A", "B", "approach:A"]);
    delete (globalThis as any).window;
  });

  it("التخزين غير متاح (نافذة خاصة): لا استثناء", async () => {
    (globalThis as any).window = { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } };
    const mod = await import("../../frontend/src/lib/appointmentAlarm");
    expect(mod.claimAlarmPlayback("Z")).toBe(true);
    delete (globalThis as any).window;
  });

  it("الرنة مضبوطة على عدم التكرار (loop=false)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/lib/appointmentAlarm.ts"), "utf8");
    expect(src).toMatch(/audio\.loop = false/);
    expect(src).not.toMatch(/loop = true/);
  });
});
