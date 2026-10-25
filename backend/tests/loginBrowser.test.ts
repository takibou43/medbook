import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { isKnownLoginBrowser, rememberLoginBrowser } from "../src/lib/loginBrowser";

describe("signed login browser hint", () => {
  it("binds to the email, expires, and does not expose the email", () => {
    vi.useFakeTimers();
    try {
      const cookie = vi.fn();
      rememberLoginBrowser({ cookie } as unknown as Response, "doctor@example.test");
      const [name, value, options] = cookie.mock.calls[0];
      const req = (email: string, token = value) => ({ body: { email }, cookies: { [name]: token } } as unknown as Request);
      expect(value).not.toContain("doctor@example.test");
      expect(options.httpOnly).toBe(true);
      expect(isKnownLoginBrowser(req("DOCTOR@example.test"))).toBe(true);
      expect(isKnownLoginBrowser(req("other@example.test"))).toBe(false);
      expect(isKnownLoginBrowser(req("doctor@example.test", "forged"))).toBe(false);
      vi.advanceTimersByTime(7 * 86400000 + 1);
      expect(isKnownLoginBrowser(req("doctor@example.test"))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
