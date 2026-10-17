import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../src/lib/escapeHtml.ts";

test("escapeHtml يرمّز الوسوم والاقتباسات", () => {
  assert.equal(escapeHtml("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(escapeHtml(`a"b'c&d`), "a&quot;b&#39;c&amp;d");
});

test("escapeHtml يترك النص العربي كما هو", () => {
  assert.equal(escapeHtml("د. محمد بن عيسى"), "د. محمد بن عيسى");
});
