import { createHash, randomUUID } from "crypto";

/** Opaque invalidation only: no patient data, identifiers or mutation details. */
export class LiveUpdates {
  private revision = randomUUID();
  private reset = randomUUID();
  private doctors = new Map<string, string>();
  private listeners = new Set<(revision: string) => void>();

  current(scope?: string[]) {
    if (!scope) return this.revision;
    return createHash("sha256").update(this.reset + JSON.stringify([...scope].sort().map(id => [id, this.doctors.get(id) ?? ""]))).digest("hex");
  }

  publish(scope?: string[]) {
    this.revision = randomUUID();
    if (!scope?.length || this.doctors.size > 10_000) {
      this.reset = this.revision;
      this.doctors.clear();
    } else {
      for (const id of scope) this.doctors.set(id, this.revision);
    }
    for (const listener of [...this.listeners]) listener(this.revision);
  }

  subscribe(listener: (revision: string) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

export const liveUpdates = new LiveUpdates();
