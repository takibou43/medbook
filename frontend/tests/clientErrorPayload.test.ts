import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientErrorPayload, generalizeRoute, safeAsset } from "../src/lib/clientErrorPayload.ts";

const ORIGIN = "https://medbook.example";
const SENSITIVE = [
  "محمد بن علي", "فاطمة الزهراء", "Ahmed Benali", "Sarah Martin",
  "سكري من النوع الثاني", "hypertension artérielle", "Diagnosis: asthma",
  "eyJhbGciOiJIUzI1NiJ9.fake.signature", "sk_live_FAKE1234567890", "AKIAFAKEKEY1234567",
  "0551234567", "patient@example.dz", "cm3x9k2abc0001",
];

test("patient: error text, stack, URL ids and query never leave the browser", () => {
  for (const secret of SENSITIVE) {
    const err = new TypeError(`Cannot read properties of ${secret}`);
    err.stack = `TypeError: ${secret}\n    at render (${ORIGIN}/assets/index-B4kd8sXz.js:12:4)`;
    const payloads = [
      buildClientErrorPayload({ portal: "patient", kind: "error", error: err, message: err.message, filename: `${ORIGIN}/assets/index-B4kd8sXz.js?u=${secret}`, line: 12, column: 4, pathname: `/clinics/${encodeURIComponent(secret)}`, origin: ORIGIN }),
      buildClientErrorPayload({ portal: "patient", kind: "unhandledrejection", error: { message: secret, name: secret, code: secret }, pathname: `/${secret}/status/${secret}`, origin: ORIGIN }),
      buildClientErrorPayload({ portal: "patient", kind: "unhandledrejection", error: secret, pathname: "/assistant/accept/" + secret, origin: ORIGIN }),
    ];
    for (const p of payloads) {
      const json = JSON.stringify(p);
      assert.ok(!json.includes(secret), `leaked: ${secret}`);
      assert.ok(!json.includes(encodeURIComponent(secret)));
      assert.deepEqual(Object.keys(p).filter((k) => !["portal", "kind", "category", "code", "route", "asset", "line", "column"].includes(k)), []);
    }
  }
});

test("patient: keeps useful technical data", () => {
  const p = buildClientErrorPayload({ portal: "patient", kind: "error", error: new TypeError("x"), filename: `${ORIGIN}/assets/index-B4kd8sXz.js`, line: 3, column: 9, pathname: "/clinics/abc123", origin: ORIGIN });
  assert.deepEqual(p, { portal: "patient", kind: "error", category: "TypeError", route: "/clinics/:param", asset: "index-B4kd8sXz.js", line: 3, column: 9 });
  const chunk = buildClientErrorPayload({ portal: "patient", kind: "unhandledrejection", error: new TypeError("Failed to fetch dynamically imported module"), pathname: "/account", origin: ORIGIN });
  assert.equal(chunk.kind, "chunk");
  assert.equal(chunk.code, "CHUNK_LOAD");
  assert.equal(safeAsset("https://cdn.other.example/assets/index-B4kd8sXz.js", ORIGIN), undefined);
  assert.equal(generalizeRoute("/assistant/accept/tok3n?x=1"), "/assistant/accept/:param");
});
