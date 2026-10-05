import assert from "node:assert/strict";
import { test } from "node:test";
import { statusPollInterval } from "../src/lib/statusPolling.ts";

test("today's waiting and called patients keep the live refresh rate", () => {
  for (const status of ["PENDING", "CONFIRMED", "LATE", "IN_PROGRESS"]) {
    assert.equal(statusPollInterval({ status, isToday: true }, 20_000), 20_000);
  }
});

test("future appointments refresh once a minute, then resume live refresh on their day", () => {
  assert.equal(statusPollInterval({ status: "CONFIRMED", isToday: false }, 20_000), 60_000);
  assert.equal(statusPollInterval({ status: "CONFIRMED", isToday: true }, 20_000), 20_000);
});

test("finished appointments stop periodic requests regardless of their date", () => {
  for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULE_REQUIRED"]) {
    for (const isToday of [true, false]) {
      assert.equal(statusPollInterval({ status, isToday }, 20_000), false);
    }
  }
});

test("missing data still retries through polling instead of stopping recovery", () => {
  assert.equal(statusPollInterval(undefined, 20_000), 20_000);
});
