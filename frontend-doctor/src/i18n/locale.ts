import french from "./fr.json" with { type: "json" };
import arabic from "./ar.json" with { type: "json" };

export type Language = "ar" | "fr";
const STORAGE_KEY = "medbook-language";
const listeners = new Set<() => void>();
let language: Language = "ar";
try { if (localStorage.getItem(STORAGE_KEY) === "fr") language = "fr"; } catch { /* Private browsing. */ }

export function getLanguage(): Language { return language; }
export function getLocale(): string { return language === "fr" ? "fr-DZ" : "ar-DZ"; }
export function subscribeLanguage(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function applyLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fr" ? "ltr" : "rtl";
}
if (typeof document !== "undefined") applyLanguage();
export function setLanguage(next: Language) {
  if (next !== "ar" && next !== "fr") return;
  if (language === next) return;
  language = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* The selection still works in memory. */ }
  applyLanguage();
  listeners.forEach(listener => listener());
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === STORAGE_KEY) setLanguage(event.newValue === "fr" ? "fr" : "ar");
});

const dictionary: Record<string, string> = french;
const corrections: Record<string, string> = arabic;
// Only application-owned strings are passed to t. Patient names, notes and form values stay untouched.
export function t(text: string, values?: Record<string, unknown>): string;
export function t<T>(text: T): T;
export function t(text: unknown, values?: Record<string, unknown>): unknown {
  if (typeof text !== "string") return text;
  const key = text.replace(/\s+/g, " ").trim();
  const entry = language === "fr" ? dictionary[key] : corrections[key];
  let translated = entry === undefined ? text : (text.match(/^\s*/)?.[0] ?? "") + entry + (text.match(/\s*$/)?.[0] ?? "");
  if (values) translated = translated.replace(/\{(\w+)\}/g, (token, name: string) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : token);
  return translated;
}
export function catalogName(item?: { nameAr: string; nameFr?: string | null } | null): string {
  if (!item) return "";
  return language === "fr" ? item.nameFr?.trim() || t(item.nameAr) : item.nameAr;
}
