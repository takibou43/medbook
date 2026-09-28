import type { AppointmentStatus, MyAppointment } from "../types/index.ts";

export const APPOINTMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = "medbook_patient_appointments_v1:";

export interface CachedPatientAppointment {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  type: "IN_PERSON" | "FOLLOW_UP" | "ONLINE";
  status: AppointmentStatus;
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  hasReview: boolean;
}

export interface AppointmentCacheEntry {
  savedAt: number;
  appointments: CachedPatientAppointment[];
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const statuses: AppointmentStatus[] = ["PENDING", "CONFIRMED", "IN_PROGRESS", "LATE", "COMPLETED", "CANCELLED", "NO_SHOW"];
const types = ["IN_PERSON", "FOLLOW_UP", "ONLINE"] as const;

function keyFor(userId: string) { return `${KEY_PREFIX}${userId}`; }
function isString(value: unknown): value is string { return typeof value === "string"; }

function isCachedAppointment(value: unknown): value is CachedPatientAppointment {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isString(item.id) && isString(item.date) && isString(item.startTime) && isString(item.endTime) &&
    types.includes(item.type as (typeof types)[number]) && statuses.includes(item.status as AppointmentStatus) &&
    isString(item.doctorId) && isString(item.doctorName) && isString(item.specialtyName) && typeof item.hasReview === "boolean";
}

export function toCachedPatientAppointment(a: MyAppointment): CachedPatientAppointment {
  return {
    id: a.id,
    date: a.date,
    startTime: a.startTime,
    endTime: a.endTime,
    type: a.type,
    status: a.status,
    doctorId: a.doctor.id,
    doctorName: [a.doctor.firstName, a.doctor.lastName].filter(Boolean).join(" "),
    specialtyName: a.doctor.specialty?.nameAr ?? "",
    hasReview: Boolean(a.review),
  };
}

export function fromCachedPatientAppointment(a: CachedPatientAppointment): MyAppointment {
  const parts = a.doctorName.trim().split(/\s+/);
  return {
    id: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime, type: a.type, status: a.status,
    doctor: { id: a.doctorId, firstName: parts.shift() ?? "", lastName: parts.join(" "), specialty: { nameAr: a.specialtyName } },
    review: a.hasReview ? { id: "", rating: 0, createdAt: "" } : null,
  };
}

export function saveAppointmentCache(userId: string, appointments: MyAppointment[], storage: StorageLike = localStorage, now = Date.now()) {
  if (!userId) return;
  const entry: AppointmentCacheEntry = { savedAt: now, appointments: appointments.map(toCachedPatientAppointment) };
  storage.setItem(keyFor(userId), JSON.stringify(entry));
}

export function loadAppointmentCache(userId: string, storage: StorageLike = localStorage, now = Date.now()): AppointmentCacheEntry | null {
  if (!userId) return null;
  const key = keyFor(userId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) || value.savedAt > now ||
      now - value.savedAt > APPOINTMENT_CACHE_TTL_MS || !Array.isArray(value.appointments) ||
      !value.appointments.every(isCachedAppointment)) {
      storage.removeItem(key);
      return null;
    }
    return value as unknown as AppointmentCacheEntry;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearAppointmentCache(userId: string, storage: StorageLike = localStorage) {
  if (userId) storage.removeItem(keyFor(userId));
}

export function clearInvalidAppointmentCaches(storage: StorageLike = localStorage, now = Date.now()) {
  const ids: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(KEY_PREFIX)) ids.push(key.slice(KEY_PREFIX.length));
  }
  ids.forEach((id) => loadAppointmentCache(id, storage, now));
}
