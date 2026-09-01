import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from "../src/utils/jwt";

describe("JWT — Authentication", () => {
  it("ينشئ Access Token صالحًا ويستخرج منه نفس البيانات", () => {
    const token = signAccessToken({ sub: "user-123", role: "PATIENT" });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("user-123");
    expect(payload.role).toBe("PATIENT");
  });

  it("يرمي خطأ عند التحقق من توكن غير صالح", () => {
    expect(() => verifyAccessToken("توكن.غير.صالح")).toThrow();
  });

  it("ينشئ ويتحقق من Refresh Token بشكل منفصل عن Access Token", () => {
    const token = signRefreshToken({ sub: "user-456" });
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe("user-456");
  });
});
