import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthPing } from "../src/lib/healthPing";

afterEach(() => vi.useRealTimers());

describe("bounded health keep-alive", () => {
  it("consumes responses, clears its timer and permits the next ping", async () => {
    vi.useFakeTimers();
    const body = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const fetcher = vi.fn().mockResolvedValue({ arrayBuffer: body });
    const ping = createHealthPing("https://example.test", fetcher);
    await ping(); await ping();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toBe("https://example.test/health");
    expect(body).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap and aborts a stalled request before recovering", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const fetcher = vi.fn().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    })).mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) });
    const ping = createHealthPing("https://example.test", fetcher);
    const pending = ping();
    await ping();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(signal.aborted).toBe(true);
    await ping();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers after network and body failures without unhandled rejections", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ arrayBuffer: async () => { throw new Error("body failed"); } })
      .mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) });
    const ping = createHealthPing("https://example.test", fetcher);
    await ping(); await ping(); await ping();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
