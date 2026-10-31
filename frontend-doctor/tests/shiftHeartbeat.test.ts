import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { applyHeartbeatResult, createShiftHeartbeatSender, isShiftState, shiftQueryKey } from "../src/lib/shiftHeartbeat.ts";

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
  it("rejects a response when the shift changes during cancellation", async () => {
    const qc = new QueryClient();
    qc.setQueryData(shiftQueryKey("u1"), state);
    let release!: () => void;
    const cancel = qc.cancelQueries.bind(qc);
    qc.cancelQueries = async () => { await new Promise<void>(resolve => { release = resolve; }); };
    const sender = createShiftHeartbeatSender(qc, "u1", async () => ({ data: state }));
    const pending = sender.send();
    await Promise.resolve();
    const ended = { active: false, endsAt: null };
    qc.setQueryData(shiftQueryKey("u1"), ended);
    release();
    await pending;
    assert.deepEqual(qc.getQueryData(shiftQueryKey("u1")), ended);
    sender.stop(); qc.cancelQueries = cancel; qc.clear();
  });

  it("does not restore account data removed before effect cleanup", async () => {
    const qc = new QueryClient();
    qc.setQueryData(shiftQueryKey("u1"), state);
    let release!: (value: unknown) => void;
    const sender = createShiftHeartbeatSender(qc, "u1", () => new Promise(resolve => { release = resolve; }));
    const pending = sender.send();
    qc.removeQueries({ queryKey: ["shift"] });
    release({ data: state });
    await pending;
    assert.equal(qc.getQueryData(shiftQueryKey("u1")), undefined);
    sender.stop(); qc.clear();
  });

  it("keeps restarted duty when the stopped duty response arrives last", async () => {
    const qc = new QueryClient();
    qc.setQueryData(shiftQueryKey("u1"), state);
    let release!: (value: unknown) => void;
    const old = createShiftHeartbeatSender(qc, "u1", () => new Promise(resolve => { release = resolve; }));
    const pending = old.send();
    old.stop();
    const restarted = { ...state, endsAt: "2026-10-30T17:00:00.000Z" };
    qc.setQueryData(shiftQueryKey("u1"), restarted);
    const next = createShiftHeartbeatSender(qc, "u1", async () => ({ data: restarted }));
    await next.send();
    release({ data: { active: false, endsAt: null } });
    await pending;
    assert.deepEqual(qc.getQueryData(shiftQueryKey("u1")), restarted);
    next.stop(); qc.clear();
  });
  it("stores a current heartbeat without an extra GET and retries after a failed request", async () => {
    const { qc, gets, unsubscribe } = await mountShiftQuery({ ...state, endsAt: "2026-10-30T15:01:10.000Z" });
    let calls = 0;
    const sender = createShiftHeartbeatSender(qc, "u1", async () => {
      if (++calls === 1) throw new Error("offline");
      return { data: state };
    });
    await sender.send();
    await sender.send();
    assert.equal(calls, 2);
    assert.equal(gets(), 1);
    assert.deepEqual(qc.getQueryData(shiftQueryKey("u1")), state);
    sender.stop(); unsubscribe(); qc.clear();
  });

  it("ignores a delayed heartbeat after a newer shift state was received", async () => {
    const qc = new QueryClient();
    qc.setQueryData(shiftQueryKey("u1"), state);
    let release!: (body: unknown) => void;
    const sender = createShiftHeartbeatSender(qc, "u1", () => new Promise(resolve => { release = resolve; }));
    const pending = sender.send();
    const ended = { active: false, endsAt: null };
    qc.setQueryData(shiftQueryKey("u1"), ended);
    release({ data: state });
    await pending;
    assert.deepEqual(qc.getQueryData(shiftQueryKey("u1")), ended);
    sender.stop(); qc.clear();
  });

  it("aborts on cleanup, never overlaps heartbeats, and cannot recreate cleared account data", async () => {
    const qc = new QueryClient();
    qc.setQueryData(shiftQueryKey("u1"), state);
    let release!: (body: unknown) => void;
    let calls = 0;
    let signal!: AbortSignal;
    const sender = createShiftHeartbeatSender(qc, "u1", requestSignal => {
      calls++; signal = requestSignal;
      return new Promise(resolve => { release = resolve; });
    });
    const pending = sender.send();
    await sender.send();
    assert.equal(calls, 1);
    sender.stop(); qc.clear();
    assert.equal(signal.aborted, true);
    release({ data: state });
    await pending;
    await sender.send();
    assert.equal(calls, 1);
    assert.equal(qc.getQueryData(shiftQueryKey("u1")), undefined);
  });
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
    assert.match(src, /createShiftHeartbeatSender\(qc, user\.id/);
    assert.doesNotMatch(src, /heartbeat"\)\.then\(\(\) => qc\.invalidateQueries/);
  });
});
