/** Run serially; a mutation during a run requests one more run, never overlaps it. */
export function adaptiveJob(run: () => Promise<unknown>, nextDelay: () => Promise<number>, retryMs = 60_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = false;
  const execute = async () => {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    let delay = retryMs;
    try { await run(); delay = await nextDelay(); }
    catch { /* Preserve periodic recovery after a transient database failure. */ }
    finally {
      running = false;
      if (!stopped) {
        timer = setTimeout(() => { void execute(); }, again ? 0 : Math.max(1000, delay));
        again = false;
      }
    }
  };
  const wake = () => {
    if (stopped) return;
    clearTimeout(timer);
    if (running) again = true;
    else timer = setTimeout(() => { void execute(); }, 0);
  };
  wake();
  return { wake, stop: () => { stopped = true; clearTimeout(timer); } };
}
