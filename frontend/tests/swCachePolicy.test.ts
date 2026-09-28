import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("service worker bypasses API requests and caches an app-shell fallback", () => {
  assert.match(source, /url\.pathname\.indexOf\("\/api\/"\) === 0\) return/);
  assert.match(source, /shell\.put\("\/index\.html"/);
  assert.match(source, /caches\.match\("\/index\.html"/);
});

test("Cache Storage contains no appointment identifiers or API responses", () => {
  assert.doesNotMatch(source, /ALARM_CACHE|caches\.open\([^)]*appointment/i);
  assert.doesNotMatch(source, /cache\.put\([^\n]*(appointmentId|\/api\/)/i);
});
