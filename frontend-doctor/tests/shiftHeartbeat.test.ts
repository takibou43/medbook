import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { applyHeartbeatResult, isShiftState, shiftQueryKey } from "../src/lib/shiftHeartbeat.ts";

const state = { active: true, endsAt: "2026-10-30T15:01:30.000Z", suggestedEndTime: "16:00", hasActiveAssistant: false };

// Mirrors ShiftControl: an active observer on ["shift", userId] backed by GET /shifts.
async function mountShiftQuery(initial: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let getCalls = 0;
  const observer = new QueryObserver(qc, {
    queryKey: shiftQueryKey("u1"),
    queryFn: async () => { getCalls++; return initial; },
    staleTime: 30_000,
  });
  const unsubscribe = observer.subscribe(() => {});
  await new Promise(r => setTimeout(r, 0));
  return { qc, gets: () => getCalls, unsubscribe };
}

describe("shift heartbeat", () => {
  it("stores the heartbeat's own shift state instead of requesting GET /shifts again", async () => {
    const { qc, gets, unsubscribe } = await mountShiftQuery({ ...state, endsAt: "2026-10-30T15:01:10.000Z" });
    assert.equal(gets(), 1);
    await applyHeartbeatResult(qc, "u1", { success: true, data: state });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(gets(), 1, "no extra GET /shifts per heartbeat");
    assert.deepEqual(qc.getQueryData(shiftQueryKey("u1")), state);
    unsubscribe();
    qc.clear();
  });

  it("falls back to the previous refetch when the response shape is unexpected", async () => {
    const { qc, gets, unsubscribe } = await mountShiftQuery(state);
    await applyHeartbeatResult(qc, "u1", { success: true });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(gets(), 2);
    await applyHeartbeatResult(qc, "u1", { data: { active: "yes", endsAt: 5 } });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(gets(), 3);
    unsubscribe();
    qc.clear();
  });

  it("does not let an older in-flight GET overwrite the fresher heartbeat state", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release: (v: unknown) => void = () => {};
    const stale = { ...state, endsAt: "2026-10-30T15:00:50.000Z" };
    const pending = qc.fetchQuery({ queryKey: shiftQueryKey("u1"), queryFn: () => new Promise(r => { release = r; }) }).catch(() => undefined);
    await applyHeartbeatResult(qc, "u1", { data: state });
    release(stale);
    await pending;
    assert.deepEqual(qc.getQueryData(shiftQueryKey("u1")), state);
    qc.clear();
  });

  it("accepts the server shiftState shape, including an ended shift", () => {
    assert.ok(isShiftState(state));
    assert.ok(isShiftState({ active: false, endsAt: null }));
    assert.ok(!isShiftState(null));
    assert.ok(!isShiftState({ endsAt: null }));
  });

  it("keeps ShiftControl on the same query key and stops the follow-up refetch", () => {
    const src = readFileSync(new URL("../src/components/ShiftControl.tsx", import.meta.url), "utf8");
    assert.match(src, /queryKey: \["shift", user\?\.id\]/);
    assert.match(src, /applyHeartbeatResult\(qc, user\.id, res\.data\)/);
    assert.doesNotMatch(src, /heartbeat"\)\.then\(\(\) => qc\.invalidateQueries/);
  });
});
