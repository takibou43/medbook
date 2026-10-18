/** Personal name-only vocabulary. No patient identity, doses or usage history is stored. */
const key = (owner: string) => `medbook-medication-names-v1:${owner}`;
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ");

export function readMedicationNames(owner: string): string[] {
  if (!owner) return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(owner)) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string").map(normalize).filter(v => v.length > 1 && v.length <= 200))].slice(0, 500) : [];
  } catch { return []; }
}

export function rememberMedicationName(owner: string, name: string): string[] {
  const names = readMedicationNames(owner);
  const next = normalize(name);
  if (!owner || next.length < 2 || next.length > 200) return names;
  const updated = [next, ...names.filter(n => n.toLocaleLowerCase() !== next.toLocaleLowerCase())].slice(0, 500);
  try { localStorage.setItem(key(owner), JSON.stringify(updated)); } catch { /* Manual entry still works. */ }
  return updated;
}
