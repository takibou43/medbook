import { describe, expect, it } from "vitest";
import { LiveUpdates } from "../src/lib/liveUpdates";

describe("opaque live invalidation", () => {
  it("isolates doctor revisions and updates a shared assistant only for assigned doctors", () => {
    const bus = new LiveUpdates();
    const a = bus.current(["a"]); const b = bus.current(["b"]); const shared = bus.current(["a", "b"]);
    bus.publish(["a"]);
    expect(bus.current(["a"])).not.toBe(a); expect(bus.current(["b"])).toBe(b);
    expect(bus.current(["b", "a"])).not.toBe(shared);
    const before = bus.current(["b"]); bus.publish(); expect(bus.current(["b"])).not.toBe(before);
  });
  it("changes revisions without carrying medical data and removes closed listeners", () => {
    const bus = new LiveUpdates();
    const initial = bus.current();
    const seen: string[] = [];
    const close = bus.subscribe(value => seen.push(value));
    bus.publish();
    expect(seen).toEqual([bus.current()]);
    expect(bus.current()).not.toBe(initial);
    close(); bus.publish();
    expect(seen).toHaveLength(1);
  });
  it("notifies all listeners even when one unsubscribes during notification", () => {
    const bus = new LiveUpdates();
    let called = 0;
    const close = bus.subscribe(() => { called++; close(); });
    bus.subscribe(() => { called++; });
    bus.publish(); expect(called).toBe(2);
  });
});
