import type { Beneficiary } from "../types/index.ts";
import { beneficiaryLabel } from "./family.ts";

export function platformText(text: string): string {
  return text.replace(/MadBook|مادبوك|ميدبوك/giu, "MedBook").replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => arabicDate(date));
}

export function patientName(beneficiary?: Beneficiary): string {
  if (!beneficiary) return "اسم المستفيد غير متاح";
  return beneficiary.type === "FAMILY_MEMBER" ? beneficiaryLabel(beneficiary) : beneficiary.name || "اسم المستفيد غير متاح";
}

export function arabicDate(date?: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date) || !Number.isFinite(Date.parse(date))) return "التاريخ غير متاح";
  return new Date(date.length > 10 ? date : date + "T12:00:00Z").toLocaleDateString("ar-DZ", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Algiers",
  });
}

export function timeGroups(times: string[]) {
  return [
    { label: "الفترة الصباحية", times: times.filter(t => Number(t.slice(0, 2)) < 12) },
    { label: "الفترة المسائية", times: times.filter(t => Number(t.slice(0, 2)) >= 12) },
  ].filter(g => g.times.length);
}

export function directionsUrl(address?: string | null, city?: string, wilaya?: string, latitude?: number | null, longitude?: number | null): string | null {
  const coordinates = typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const destination = coordinates ? `${latitude},${longitude}` : address?.trim() ? [address.trim(), city, wilaya, "الجزائر"].filter(Boolean).join("، ") : null;
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : null;
}
