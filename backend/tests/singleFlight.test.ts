import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "../src/lib/singleFlight";
describe("authorized concurrent reads", () => {
  it("shares concurrent reads only for the same doctor and revision, retaining no result", async () => {
    const read = singleFlight<number>();
    let finish!: (value: number) => void;
    const query = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const first = read("doctor-a:revision-1", query);
    const second = read("doctor-a:revision-1", query);
    await Promise.resolve(); expect(query).toHaveBeenCalledTimes(1);
    finish(10); expect(await first).toBe(10); expect(await second).toBe(10);
    expect(await read("doctor-a:revision-1", async () => 20)).toBe(20);
  });
  it("never shares another doctor's data or reuses a pre-mutation read", async () => {
    const read = singleFlight<string>();
    const previous = read("doctor-a:revision-1", async () => "old");
    expect(await read("doctor-a:revision-2", async () => "new")).toBe("new");
    expect(await read("doctor-b:revision-1", async () => "other")).toBe("other");
    await previous;
  });
  it("removes failed work so the next request can recover", async () => {
    const read = singleFlight<number>();
    await expect(read("doctor-a:1", async () => { throw new Error("temporary"); })).rejects.toThrow("temporary");
    expect(await read("doctor-a:1", async () => 1)).toBe(1);
  });
});
