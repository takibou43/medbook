import { RequestHandler } from "express";
import { liveUpdates } from "../lib/liveUpdates";

export const liveInvalidation: RequestHandler = (req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) &&
      /^\/(appointments|booking|doctor|assistant|clinics|admin|patient)(\/|$)/.test(req.path)) {
    let doctors: string[] | undefined;
    if (/^\/(appointments|booking)(\/|$)/.test(req.path)) {
      const json = res.json;
      res.json = function (body: unknown) {
        doctors = affectedDoctors(body);
        return json.call(this, body);
      };
    }
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) liveUpdates.publish(doctors);
    });
  }
  next();
};

// Extract only authoritative doctor IDs from successful server response data.
// Unknown shapes conservatively invalidate all scopes; no payload is broadcast.
export function affectedDoctors(body: unknown): string[] {
  const ids = new Set<string>();
  let visited = 0;
  let truncated = false;
  const visit = (value: unknown, depth: number) => {
    if (++visited > 2000 || depth > 6) { truncated = true; return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.doctorId === "string") ids.add(record.doctorId);
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(body, 0);
  return truncated ? [] : [...ids];
}
