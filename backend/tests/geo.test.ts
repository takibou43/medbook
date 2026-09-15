import { describe, it, expect } from "vitest";
import { haversineKm, roundDistanceKm } from "../src/lib/geo";

describe("geo — حساب المسافة (Haversine)", () => {
  it("المسافة بين نقطة ونفسها = صفر", () => {
    expect(haversineKm(36.7764, 3.0586, 36.7764, 3.0586)).toBe(0);
  });

         it("المسافة بين الجزائر العاصمة وميلة تقريبًا ~280 كم", () => {
           // الجزائر العاصمة (16.7764,3.0586) — ميلة (36.4481,6.2622)
            const km = haversineKm(36.7764, 3.0586, 36.4481, 6.2622);
           expect(km).toBeGreaterThan(250);
           expect(km).toBeLessThan(320);
         });

         it("roundDistanceKm يقرّب لخانة عشرية واحدة", () => {
           expect(roundDistanceKm(1.234)).toBe(1.2);
           expect(roundDistanceKm(1.26)).toBe(1.3);
         });
});
