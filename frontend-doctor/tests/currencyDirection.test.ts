import assert from "node:assert/strict";
import test from "node:test";
import { formatDzd } from "../src/lib/doctorUi.ts";
import { setLanguage } from "../src/i18n/locale.ts";

test("clinic report amounts retain thousands order in Arabic and French", () => {
  try {
    for (const language of ["ar", "fr"] as const) {
      setLanguage(language);
      for (const [value, digits] of [[180000, "180 000"], [178200, "178 200"], [1800, "1 800"], [181500, "181 500"], [179550, "179 550"], [1950, "1 950"], [0, "0"]] as const) {
        assert.equal(formatDzd(value), "\u2066" + digits + "\u2069 " + (language === "ar" ? "دج" : "DA"));
      }
    }
  } finally { setLanguage("ar"); }
});
