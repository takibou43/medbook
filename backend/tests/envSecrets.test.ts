/**
 * أسرار JWT إلزامية بلا أي قيمة احتياطية: غيابها أو فراغها يُفشل تحميل الإعدادات (وبالتالي إقلاع الخادم)
 * برسالة تذكر اسم المتغير فقط — دون طباعة أي قيمة سرية.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// لا نريد أن يعيد dotenv تعبئة المتغيرات من ملف .env محلي أثناء هذا الاختبار.
vi.mock("dotenv/config", () => ({}));

const KEYS = ["JWT_SECRET", "JWT_REFRESH_SECRET", "DATABASE_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  vi.resetModules();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

async function loadEnv() {
  return (await import("../src/config/env")).env;
}

describe("أسرار JWT — فشل الإقلاع عند غيابها", () => {
  it("يُحمَّل بنجاح عندما تكون كل الأسرار مضبوطة", async () => {
    const env = await loadEnv();
    expect(env.jwtSecret).toBe(process.env.JWT_SECRET);
  });

  it.each(["JWT_SECRET", "JWT_REFRESH_SECRET"])("يفشل عند غياب %s", async (key) => {
    delete process.env[key];
    await expect(loadEnv()).rejects.toThrow(key);
  });

  it.each(["", "   "])("يفشل عندما يكون JWT_SECRET فارغًا (%j)", async (value) => {
    process.env.JWT_SECRET = value;
    await expect(loadEnv()).rejects.toThrow("JWT_SECRET");
  });

  it("لا توجد قيمة احتياطية ثابتة لـ JWT في الكود", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../src/config/env.ts"), "utf8");
    expect(src).not.toMatch(/dev_secret|change_me/i);
    expect(src).toMatch(/jwtSecret:\s*required\("JWT_SECRET"\)/);
    expect(src).toMatch(/jwtRefreshSecret:\s*required\("JWT_REFRESH_SECRET"\)/);
  });

  it("رسالة الخطأ لا تحتوي على أي قيمة سرية", async () => {
    const secret = "super-secret-refresh-value-123";
    process.env.JWT_REFRESH_SECRET = secret;
    delete process.env.JWT_SECRET;
    const err = await loadEnv().then(
      () => null,
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).not.toContain(secret);
    expect(err!.message).not.toContain(saved.DATABASE_URL ?? "@@none@@");
  });
});
