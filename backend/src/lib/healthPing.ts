/** Bound keep-alive work even when the public endpoint stops responding. */
export function createHealthPing(baseUrl: string, fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(new URL("/health", baseUrl), { signal: controller.signal });
      // Consume the small response so the connection can be reused.
      await response.arrayBuffer();
    } catch {
      // GitHub's independent wake-up and the next interval remain the fallback.
    } finally {
      clearTimeout(timeout);
      running = false;
    }
  };
}
