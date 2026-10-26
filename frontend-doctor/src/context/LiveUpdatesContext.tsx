import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { api, API_URL } from "../lib/api";
import { LIVE_QUERY_ROOTS } from "../lib/livePolling";
import { shareLiveConnection, type LiveSignal } from "../lib/sharedLiveConnection";

const LiveUpdatesContext = createContext(false);
export function useLiveUpdates() { return useContext(LiveUpdatesContext); }

export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!user || !["DOCTOR", "ASSISTANT"].includes(user.role)) {
      setConnected(false);
      return;
    }
    let stopped = false;
    let controller: AbortController | undefined;
    let retry: number | undefined;
    let revision: string | undefined;
    let refreshing: number | undefined;
    let stopShared: (() => void) | undefined;
    let owner = false;
    let publish: (signal: LiveSignal) => void = () => {};
    const invalidate = () => {
      if (refreshing !== undefined) return;
      refreshing = window.setTimeout(() => {
        refreshing = undefined;
        void qc.invalidateQueries({ predicate: query => LIVE_QUERY_ROOTS.has(String(query.queryKey[0])) });
      }, 150);
    };
    const poll = async () => {
      if (stopped || !owner || document.hidden || !navigator.onLine) return;
      const request = new AbortController();
      controller = request;
      try {
        const res = await api.get<{ data: { revision: string } }>("/live/changes", {
          params: revision ? { since: revision } : undefined,
          signal: request.signal,
          timeout: 65_000,
        });
        if (stopped || request.signal.aborted) return;
        const next = res.data.data.revision;
        if (typeof next !== "string" || !next) throw new Error("Invalid live response");
        publish({ connected: true, revision: next });
        retry = window.setTimeout(() => { void poll(); }, 100);
      } catch {
        if (stopped || request.signal.aborted) return;
        publish({ connected: false }); // restore original fast polling on failure
        retry = window.setTimeout(() => { void poll(); }, 10_000);
      }
    };
    const restart = () => {
      stopShared?.();
      stopShared = undefined;
      controller?.abort();
      window.clearTimeout(retry);
      setConnected(false);
      revision = undefined;
      if (document.hidden || !navigator.onLine) return;
      const key = JSON.stringify(["medbook-live-v1", API_URL, user.id, user.role]);
      let channel: BroadcastChannel | undefined;
      try { if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(key); } catch { /* independent polling */ }
      stopShared = shareLiveConnection({
        key, channel, locks: navigator.locks,
        receive: signal => {
          if (stopped) return;
          if (signal.connected && signal.revision && revision !== signal.revision) {
            revision = signal.revision;
            invalidate();
          }
          setConnected(signal.connected);
        },
        start: send => {
          owner = true;
          revision = undefined;
          publish = send;
          void poll();
          return () => {
            owner = false;
            controller?.abort();
            window.clearTimeout(retry);
          };
        },
      });
    };
    restart();
    document.addEventListener("visibilitychange", restart);
    window.addEventListener("online", restart);
    window.addEventListener("offline", restart);
    return () => {
      stopped = true;
      stopShared?.();
      controller?.abort();
      window.clearTimeout(retry);
      window.clearTimeout(refreshing);
      document.removeEventListener("visibilitychange", restart);
      window.removeEventListener("online", restart);
      window.removeEventListener("offline", restart);
    };
  }, [user?.id, user?.role, qc]);
  return <LiveUpdatesContext.Provider value={connected}>{children}</LiveUpdatesContext.Provider>;
}
