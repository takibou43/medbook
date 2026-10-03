import { test } from "node:test";
import assert from "node:assert/strict";
import { hasBothProfiles, logoutBody, portalUrl, wantsSessionBootstrap, withoutSwitchParam } from "../src/lib/portalSwitch.ts";

const both = { patient: true, doctor: { status: "PENDING" as const } };

test("حساب الملفين فقط يخرج من الواجهتين معًا", () => {
  assert.equal(hasBothProfiles(both), true);
  assert.deepEqual(logoutBody(both), { allSessions: true });
  assert.deepEqual(logoutBody({ patient: true, doctor: null }), {});
  assert.deepEqual(logoutBody({ patient: false, doctor: { status: "VERIFIED" } }), {});
  assert.deepEqual(logoutBody(undefined), {});
});
test("رابط الانتقال يحمل علامة غير سرية فقط ولا رموز", () => {
  const url = portalUrl("https://medbook-alpha.vercel.app/", "/account");
  assert.equal(url, "https://medbook-alpha.vercel.app/account?switch=1");
  assert.doesNotMatch(url, /token|secret|jwt|refresh/i);
});
test("وجهات غير آمنة تُرفض إلى الجذر", () => {
  assert.equal(portalUrl("javascript:alert(1)"), "/");
  assert.equal(portalUrl("not a url"), "/");
  assert.equal(portalUrl("https://a.example", "//evil.example"), "https://a.example/?switch=1");
});
test("علامة التهيئة تُقرأ وتُزال مع بقاء بقية المعاملات", () => {
  assert.equal(wantsSessionBootstrap("?switch=1"), true);
  assert.equal(wantsSessionBootstrap("?switch=0"), false);
  assert.equal(wantsSessionBootstrap(""), false);
  assert.equal(withoutSwitchParam("?switch=1"), "");
  assert.equal(withoutSwitchParam("?a=1&switch=1"), "?a=1");
});
