import assert from "node:assert/strict";
import test from "node:test";
import { APPOINTMENT_CACHE_TTL_MS, clearAppointmentCachesExcept, loadAppointmentCache, saveAppointmentCache } from "../src/lib/appointmentCache.ts";

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
  key(i: number) { return [...this.values.keys()][i] ?? null; }
}
const appointment = { id: "a", date: "2026-09-28", startTime: "09:00", endTime: "09:30", type: "IN_PERSON", status: "CONFIRMED",
  doctor: { id: "d", firstName: "أحمد", lastName: "علي", phone: "0555", address: "خاص", specialty: { nameAr: "عام" }, clinic: { nameAr: "عيادة", address: "سري" } },
  review: { id: "r", rating: 5, comment: "خاص", createdAt: "now" } } as any;

test("stores the allowlist only and isolates users", () => {
  const s = new MemoryStorage(); saveAppointmentCache("u1", [appointment], s as any, 1000);
  const raw = s.getItem("medbook_patient_appointments_v1:u1")!;
  for (const secret of ["0555", "خاص", "سري", "comment", "rating"]) assert.equal(raw.includes(secret), false);
  assert.equal(loadAppointmentCache("u2", s as any, 1000), null);
  assert.equal(loadAppointmentCache("u1", s as any, 1000)?.appointments[0].hasReview, true);
});

test("deletes expired and corrupt entries", () => {
  const s = new MemoryStorage(); saveAppointmentCache("old", [appointment], s as any, 1000);
  assert.equal(loadAppointmentCache("old", s as any, 1001 + APPOINTMENT_CACHE_TTL_MS), null);
  s.setItem("medbook_patient_appointments_v1:bad", "{");
  assert.equal(loadAppointmentCache("bad", s as any), null);
  assert.equal(s.getItem("medbook_patient_appointments_v1:bad"), null);
});

test("clears every patient's cache, or all but the signed-in one", () => {
  const s = new MemoryStorage();
  saveAppointmentCache("a", [appointment], s as any, 1000);
  saveAppointmentCache("b", [appointment], s as any, 1000);
  s.setItem("unrelated", "keep");
  clearAppointmentCachesExcept("b", s as any);
  assert.equal(s.getItem("medbook_patient_appointments_v1:a"), null);
  assert.notEqual(s.getItem("medbook_patient_appointments_v1:b"), null);
  clearAppointmentCachesExcept(null, s as any);
  assert.equal(s.getItem("medbook_patient_appointments_v1:b"), null);
  assert.equal(s.getItem("unrelated"), "keep");
});
