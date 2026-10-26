import { test } from "node:test";
import assert from "node:assert/strict";
import { shareLiveConnection, type LiveSignal } from "../src/lib/sharedLiveConnection.ts";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
  const peers = new Map<string, Set<any>>();
  const queues = new Map<string, (() => void)[]>();
  const held = new Set<string>();
  const locks = { request: (key: string, options: any, callback: any) => new Promise<void>((resolve, reject) => {
    const take = () => {
      if (options.signal.aborted) { reject(new Error("aborted")); return; }
      if (held.has(key)) { queues.set(key, [...(queues.get(key) ?? []), take]); return; }
      held.add(key);
      Promise.resolve(callback({ name: key })).then(() => {
        held.delete(key); resolve(); queues.get(key)?.shift()?.();
      }, reject);
    };
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    take();
  }) } as unknown as Pick<LockManager, "request">;
  const channel = (key: string) => {
    const group = peers.get(key) ?? new Set(); peers.set(key, group);
    const c = { onmessage: null as any, frozen: false,
      postMessage(data: any) { if (!c.frozen) for (const p of group) if (p !== c) p.onmessage?.({ data }); },
      close() { group.delete(c); },
    };
    group.add(c); return c;
  };
  return { locks, channel };
}

test("three tabs share one owner, relay revisions, and take over after owner closes", async () => {
  const h = harness(); let active = 0, peak = 0;
  const send: ((s: LiveSignal) => void)[] = [];
  const events: LiveSignal[][] = [[], [], []];
  const stops = events.map((received) => shareLiveConnection({
    key: "account-A", locks: h.locks, channel: h.channel("account-A"),
    start: publish => { active++; peak = Math.max(peak, active); send.push(publish); return () => { active--; }; },
    receive: s => received.push(s),
  }));
  try {
    await flush(); assert.equal(active, 1);
    send[0]({ connected: true, revision: "revision-1" });
    assert.ok(events.every(e => e.at(-1)?.revision === "revision-1"));
    stops[0](); await flush(); assert.equal(active, 1); assert.equal(peak, 1);
    send[1]({ connected: true, revision: "revision-2" });
    assert.equal(events[2].at(-1)?.revision, "revision-2");
  } finally { stops.slice(1).forEach(stop => stop()); }
  await flush(); assert.equal(active, 0);
});

test("accounts are isolated and queued hidden/closed tabs never become owners", async () => {
  const h = harness(); let owners = 0; let followerStarts = 0;
  const create = (key: string, follower = false) => shareLiveConnection({ key, locks: h.locks, channel: h.channel(key),
    start: () => { owners++; if (follower) followerStarts++; return () => { owners--; }; }, receive: () => {} });
  const a = create("A"), b = create("B"), pending = create("A", true);
  pending(); a(); b(); await flush();
  assert.equal(followerStarts, 0); assert.equal(owners, 0);
});

test("missing browser capabilities retain independent polling", () => {
  let starts = 0, stops = 0;
  const stop = shareLiveConnection({key: "A", start: publish => { starts++; publish({connected:false}); return () => { stops++; }; }, receive: s => assert.equal(s.connected, false)});
  assert.equal(starts, 1); stop(); assert.equal(stops, 1);
});

test("a frozen owner makes followers restore safety polling", async t => {
  t.mock.timers.enable({apis: ["Date", "setInterval"]});
  const h = harness(); const states: LiveSignal[] = []; let publish: (s: LiveSignal) => void = () => {};
  const ownerChannel = h.channel("A");
  const owner = shareLiveConnection({key:"A", locks:h.locks, channel:ownerChannel, start: send => {publish=send; return () => {};}, receive:()=>{}});
  const follower = shareLiveConnection({key:"A", locks:h.locks, channel:h.channel("A"), start:()=>()=>{}, receive:s=>states.push(s)});
  try {
    publish({connected:true, revision:"v1"});
    assert.equal(states.at(-1)?.connected, true);
    ownerChannel.frozen = true;
    t.mock.timers.tick(16_000);
    assert.equal(states.at(-1)?.connected, false);
  } finally { follower(); owner(); await flush(); t.mock.timers.reset(); }
});
