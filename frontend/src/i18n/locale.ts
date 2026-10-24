import arabic from "./ar.json" with { type: "json" };

export type Language = "ar" | "fr";
const STORAGE_KEY = "medbook-language";
const listeners = new Set<() => void>();
let language: Language = "ar";

// القاموس الفرنسي (~190KB) لا يُحمَّل إلا عند الحاجة: العربية هي اللغة الافتراضية لمعظم الزوار،
// فلا معنى لأن يدفع كل زائر ثمن تنزيله مع الحزمة الرئيسية. يُحمَّل مرة واحدة ثم يبقى في الذاكرة.
let dictionary: Record<string, string> | null = null;
let frenchLoading: Promise<void> | null = null;
export function loadFrench(): Promise<void> {
  if (dictionary) return Promise.resolve();
  return frenchLoading ??= import("./fr.json", { with: { type: "json" } })
    .then((module) => { dictionary = module.default as Record<string, string>; })
    .catch((error) => { frenchLoading = null; throw error; });
}

let storedFrench = false;
try { storedFrench = localStorage.getItem(STORAGE_KEY) === "fr"; } catch { /* Private browsing. */ }

export function getLanguage(): Language { return language; }
export function getLocale(): string { return language === "fr" ? "fr-DZ" : "ar-DZ"; }
export function subscribeLanguage(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function applyLanguage() {
  if (typeof document === "undefined") return;
  // Use the app dictionary; a second translation pass can rewrite React text nodes.
  document.documentElement.translate = false;
  document.documentElement.classList.add("notranslate");
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fr" ? "ltr" : "rtl";
}
if (typeof document !== "undefined") applyLanguage();
let frenchRequested = false;
export function setLanguage(next: Language) {
  if (next !== "ar" && next !== "fr") return;
  frenchRequested = next === "fr";
  if (language === next) return;
  // الفرنسية تُفعَّل بعد وصول قاموسها، فلا تظهر الواجهة نصف مترجمة. إن عاد المستخدم إلى العربية
  // قبل اكتمال التحميل فلا نقلب الواجهة بعده.
  if (next === "fr" && !dictionary) {
    void loadFrench().then(() => { if (frenchRequested) setLanguage("fr"); }, () => { /* بلا شبكة: تبقى العربية. */ });
    return;
  }
  language = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* The selection still works in memory. */ }
  applyLanguage();
  listeners.forEach(listener => listener());
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === STORAGE_KEY) setLanguage(event.newValue === "fr" ? "fr" : "ar");
});

const corrections: Record<string, string> = arabic;
// Only application-owned strings are passed to t. Patient names, notes and form values stay untouched.
export function t(text: string, values?: Record<string, unknown>): string;
export function t<T>(text: T): T;
export function t(text: unknown, values?: Record<string, unknown>): unknown {
  if (typeof text !== "string") return text;
  const key = text.replace(/\s+/g, " ").trim();
  const entry = language === "fr" ? dictionary?.[key] : corrections[key];
  let translated = entry === undefined ? text : (text.match(/^\s*/)?.[0] ?? "") + entry + (text.match(/\s*$/)?.[0] ?? "");
  if (values) translated = translated.replace(/\{(\w+)\}/g, (token, name: string) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : token);
  return translated;
}
export function catalogName(item?: { nameAr: string; nameFr?: string | null } | null): string {
  if (!item) return "";
  return language === "fr" ? item.nameFr?.trim() || t(item.nameAr) : item.nameAr;
}

/**
 * يكتمل حين تصبح اللغة المحفوظة جاهزة للعرض. main.tsx ينتظره قبل أول رسم حتى لا يرى من اختار
 * الفرنسية الواجهة بالعربية لحظةً ثم تنقلب. لا يرفض أبدًا: عند تعذّر التحميل تبقى العربية.
 */
export const languageReady: Promise<void> = storedFrench
  ? loadFrench().then(() => setLanguage("fr"), () => undefined)
  : Promise.resolve();
