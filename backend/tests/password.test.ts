import { describe, it, expect } from "vitest";
import { hashPassword, comparePassword } from "../src/utils/password";

describe("Password hashing — الأمان", () => {
  it("يشفّر كلمة المرور بحيث لا تكون مطابقة للنص الأصلي", async () => {
    const hash = await hashPassword("Patient@123");
    expect(hash).not.toBe("Patient@123");
    expect(hash.length).toBeGreaterThan(20);
  });

  it("compare ينجح مع كلمة المرور الصحيحة ويفشل مع كلمة خاطئة", async () => {
    const hash = await hashPassword("Patient@123");
    expect(await comparePassword("Patient@123", hash)).toBe(true);
    expect(await comparePassword("WrongPassword", hash)).toBe(false);
  });
});
