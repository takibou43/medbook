import type { Appointment } from "../types";

export type AdvanceQueue = { current: Appointment | null; ordered?: Appointment[]; waiting: Appointment[]; late: Appointment[] };
type Requests = {
  defer: () => Promise<unknown>;
  queue: () => Promise<AdvanceQueue>;
  call: (id: string) => Promise<Appointment>;
};
export type AdvanceResult = { kind: "called" | "current"; appointment: Appointment } | { kind: "empty" } | { kind: "retry"; error: unknown };
/** After a successful deferral, failures must not repeat it or pretend the next call succeeded. */
export async function advanceAfterMissedCall(skippedId: string, requests: Requests, retry = false): Promise<AdvanceResult> {
  if (!retry) await requests.defer();
  try {
    const queue = await requests.queue();
    // Another operator may already have called someone; never replace that call.
    if (queue.current) return { kind: "current", appointment: queue.current };
    const next = (queue.ordered ?? [...queue.waiting, ...queue.late]).find(a => a.id !== skippedId);
    if (!next) return { kind: "empty" };
    return { kind: "called", appointment: await requests.call(next.id) };
  } catch (error) {
    return { kind: "retry", error };
  }
}
