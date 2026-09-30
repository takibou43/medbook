import { describe, expect, it } from "vitest";
import { SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { isDoctorPublic, shouldAnnounceDoctor } from "../src/modules/admin/admin.service";

describe("إشعار طبيب جديد في المنطقة", () => {
  it("لا يعتبر الطبيب ظاهرًا إلا إذا كان موثقًا واشتراكه فعالًا", () => {
    expect(isDoctorPublic(VerificationStatus.VERIFIED, SubscriptionStatus.ACTIVE)).toBe(true);
    expect(isDoctorPublic(VerificationStatus.PENDING, SubscriptionStatus.ACTIVE)).toBe(false);
    expect(isDoctorPublic(VerificationStatus.VERIFIED, SubscriptionStatus.UNPAID)).toBe(false);
    expect(isDoctorPublic(VerificationStatus.VERIFIED, SubscriptionStatus.EXPIRED)).toBe(false);
  });

  it("يعلن مرة الانتقال من غير ظاهر إلى ظاهر فقط", () => {
    expect(shouldAnnounceDoctor(
      VerificationStatus.PENDING,
      SubscriptionStatus.ACTIVE,
      VerificationStatus.VERIFIED,
      SubscriptionStatus.ACTIVE
    )).toBe(true);
    expect(shouldAnnounceDoctor(
      VerificationStatus.VERIFIED,
      SubscriptionStatus.UNPAID,
      VerificationStatus.VERIFIED,
      SubscriptionStatus.ACTIVE
    )).toBe(true);
    expect(shouldAnnounceDoctor(
      VerificationStatus.VERIFIED,
      SubscriptionStatus.ACTIVE,
      VerificationStatus.VERIFIED,
      SubscriptionStatus.ACTIVE
    )).toBe(false);
  });
});
