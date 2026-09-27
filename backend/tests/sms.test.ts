/**
 * sendSms — الخصوصية في السجلات والمهلة الزمنية.
 * لا اتصال فعلي بالمزوّد: fetch مستبدل. القيم أدناه وهمية.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "../src/config/env";
import { sendSms, maskPhoneForLog } from "../src/lib/sms";

const PHONE = "0551234567";
const INTL = "213551234567";
const MESSAGE = "مرحباً سارة، موعدك لدى الدكتور أمين قد فات.";
const CREDS = { budgetsmsUsername: "fake-user", budgetsmsUserId: "99999", budgetsmsHandle: "fake-handle-secret" };

let logs: string[];
const saved = { ...env.sms };

beforeEach(() => {
  logs = [];
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (a instanceof Error ? `${a.name}:${a.message}` : String(a))).join(" "));
    });
  }
  Object.assign(env.sms, CREDS);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.assign(env.sms, saved);
});

/** لا شيء حساس في أي سطر سجل ولا في النتيجة المُعادة. */
function expectNoLeak(result: unknown) {
  const all = logs.join("\n") + "\n" + JSON.stringify(result);
  for (const secret of [PHONE, INTL, "551234567", MESSAGE, "سارة", CREDS.budgetsmsHandle, CREDS.budgetsmsUsername, "budgetsms.net"]) {
    expect(all).not.toContain(secret);
  }
}

describe("maskPhoneForLog", () => {
  it("يُبقي أول 4 وآخر رقمين فقط", () => {
    expect(maskPhoneForLog(INTL)).toBe("2135******67");
    expect(maskPhoneForLog("12")).toBe("**");
  });
});

describe("sendSms", () => {
  it("نجاح: رمز SENT وسجل بلا هاتف كامل ولا نص", async () => {
    const fetchMock = vi.fn(async () => new Response("OK 123456"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendSms(PHONE, MESSAGE);
    expect(r).toEqual({ success: true, code: "SENT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as any[])[1].signal).toBeInstanceOf(AbortSignal);
    expect(logs.join("\n")).toContain("2135******67");
    expectNoLeak(r);
  });

  it("رفض المزوّد: رمز الخطأ فقط دون الرد الخام", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`ERR 1001 invalid handle fake-handle-secret for ${INTL}: ${MESSAGE}`)));
    const r = await sendSms(PHONE, MESSAGE);
    expect(r).toMatchObject({ success: false, code: "PROVIDER_REJECTED" });
    expect(r.error).toContain("ERR 1001");
    expectNoLeak(r);
  });

  it("انتهاء المهلة: TIMEOUT دون انتظار مفتوح", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
          })
      )
    );
    const started = Date.now();
    const r = await sendSms(PHONE, MESSAGE, 50);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r).toMatchObject({ success: false, code: "TIMEOUT" });
    expectNoLeak(r);
  });

  it("خطأ شبكة: رسالة الخطأ الأصلية (قد تحمل الرابط) لا تُسجَّل", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`fetch failed https://api.budgetsms.net/sendsms/?handle=fake-handle-secret&to=${INTL}`); }));
    const r = await sendSms(PHONE, MESSAGE);
    expect(r).toMatchObject({ success: false, code: "NETWORK_ERROR" });
    expectNoLeak(r);
  });

  it("مزوّد غير مُعدّ: لا طلب شبكة ولا نص الرسالة في السجل", async () => {
    Object.assign(env.sms, { budgetsmsUsername: "", budgetsmsUserId: "", budgetsmsHandle: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendSms(PHONE, MESSAGE);
    expect(r).toMatchObject({ success: false, code: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoLeak(r);
  });

  it("رقم غير صالح: لا يُعاد الرقم في الخطأ", async () => {
    const r = await sendSms("12345abc", MESSAGE);
    expect(r).toMatchObject({ success: false, code: "INVALID_PHONE" });
    expect(JSON.stringify(r) + logs.join("\n")).not.toContain("12345");
  });
});
