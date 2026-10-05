import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { livePollInterval, LIVE_QUERY_ROOTS } from "../src/lib/livePolling.ts";

describe("live board fallback", () => {
  it("keeps rapid assistant polling whenever the signal is unavailable", () => {
    assert.equal(livePollInterval(false, 4000), 4000);
    assert.equal(livePollInterval(false, 10000), 10000);
    assert.equal(livePollInterval(true, 4000), 60000);
  });
  it("refreshes both assistant views and financial/dashboard data on changes", () => {
    for (const root of ["queue", "appointments", "assistant-queues", "assistant-appointments", "assistant-daily-income", "doctor-dashboard"]) assert.ok(LIVE_QUERY_ROOTS.has(root));
  });
});
