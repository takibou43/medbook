import { describe, it, expect } from "vitest";
import { hashPassword, comparePassword } from "../src/utils/password";
import bcrypt from "bcryptjs";

describe("Password hashing — الأمان", () => {
  it("demonstrates legacy bcrypt truncation and protects new long passwords", async () => {
    const prefix = "a".repeat(72);
    const legacy = await bcrypt.hash(prefix + "ONE", 10);
    expect(await bcrypt.compare(prefix + "TWO", legacy)).toBe(true);
    const secured = await hashPassword(prefix + "ONE");
    expect(await comparePassword(prefix + "ONE", secured)).toBe(true);
    expect(await comparePassword(prefix + "TWO", secured)).toBe(false);
    expect(await comparePassword(prefix, secured)).toBe(false);
  });
  it("counts UTF-8 bytes for Arabic passwords", async () => {
    const prefix = "ع".repeat(36);
    const hash = await hashPassword(prefix + "أ");
    expect(await comparePassword(prefix + "أ", hash)).toBe(true);
    expect(await comparePassword(prefix + "ب", hash)).toBe(false);
  });
  it("preserves login for existing hashes", async () => {
    const legacy = await bcrypt.hash("Existing@123", 10);
    expect(await comparePassword("Existing@123", legacy)).toBe(true);
    expect(await comparePassword("Wrong@123", legacy)).toBe(false);
  });
  it("rejects oversized new passwords and bounds comparison input", async () => {
    await expect(hashPassword("a".repeat(129))).rejects.toMatchObject({ statusCode: 400 });
    expect(await comparePassword("a".repeat(4097), "invalid")).toBe(false);
  });
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
