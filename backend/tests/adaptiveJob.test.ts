import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptiveJob } from "../src/lib/adaptiveJob";
afterEach(() => vi.useRealTimers());
describe("adaptive jobs", () => {
  it("wakes an idle job after a booking without waiting for the quiet interval", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const job = adaptiveJob(run, async () => 3_600_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    job.wake(); await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop(); await vi.advanceTimersByTimeAsync(3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("coalesces changes during a run and never runs concurrently", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const job = adaptiveJob(run, async () => 3_600_000);
    await vi.advanceTimersByTimeAsync(0);
    job.wake(); job.wake();
    expect(run).toHaveBeenCalledTimes(1);
    finish(); await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop();
  });
  it("retries after failures", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const job = adaptiveJob(run, async () => 3_600_000, 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2); job.stop();
  });
});
