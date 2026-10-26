/** One long-poll owner per account/API origin. Messages contain no credentials or clinical data. */
export type LiveSignal = { connected: boolean; revision?: string };
type Channel = Pick<BroadcastChannel, "postMessage" | "close" | "onmessage">;
export interface SharedLiveOptions {
  key: string;
  locks?: Pick<LockManager, "request">;
  channel?: Channel;
  start: (publish: (signal: LiveSignal) => void) => () => void;
  receive: (signal: LiveSignal) => void;
}

export function shareLiveConnection({ key, locks, channel, start, receive }: SharedLiveOptions) {
  // Unsupported browsers keep the existing independent, functional connection.
  if (!locks || !channel) { channel?.close(); return start(receive); }
  const pending = new AbortController();
  let stopped = false;
  let leader = false;
  let lastSeen = Date.now();
  let latest: LiveSignal = { connected: false };
  let stopPoll: (() => void) | undefined;
  let release: (() => void) | undefined;
  const send = () => channel.postMessage({ kind: "signal", ...latest });
  const publish = (signal: LiveSignal) => {
    if (stopped) return;
    latest = signal;
    receive(signal);
    send();
  };
  channel.onmessage = event => {
    if (stopped) return;
    const msg = event.data;
    if (msg?.kind === "hello") { if (leader) send(); return; }
    if (leader || msg?.kind !== "signal" || typeof msg.connected !== "boolean") return;
    if (msg.revision !== undefined && (typeof msg.revision !== "string" || msg.revision.length > 256)) return;
    if (msg.connected && !msg.revision) return;
    lastSeen = Date.now();
    receive({ connected: msg.connected, revision: msg.revision });
  };
  channel.postMessage({ kind: "hello" });
  // An unresponsive/frozen owner must not leave followers believing live is healthy.
  const heartbeat = setInterval(() => {
    if (leader) send();
    else if (Date.now() - lastSeen > 12_000) receive({ connected: false });
  }, 4000);
  void locks.request(key, { signal: pending.signal }, async () => {
    if (stopped) return;
    leader = true;
    const hold = new Promise<void>(resolve => { release = resolve; });
    stopPoll = start(publish);
    await hold;
  }).catch(() => {
    if (!stopped) { leader = true; stopPoll = start(publish); }
  });
  return () => {
    stopped = true;
    clearInterval(heartbeat);
    stopPoll?.();
    release?.();
    pending.abort();
    channel.close();
  };
}
