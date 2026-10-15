/** Device-local, account-scoped folder handles. No prescription content is persisted here. */
export interface PrescriptionDirectory {
  name: string;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  getFileHandle(name: string, options: { create: true }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>;
}
export interface PrescriptionFolder { directory: PrescriptionDirectory }
type PickerWindow = Window & { showDirectoryPicker?: (options: { mode: "readwrite"; id: string }) => Promise<PrescriptionDirectory> };
const DATABASE = "medbook-prescription-folders-v1";
const CHANGED = "medbook-prescription-folder-changed";
export const folderSupported = () => typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("folders");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("FOLDER_STORAGE_BLOCKED"));
  });
}
async function accessFolder(uid: string, action: "get" | "put" | "delete", value?: PrescriptionFolder): Promise<PrescriptionFolder | null> {
  if (!uid) throw new Error("ACCOUNT_REQUIRED");
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("folders", action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("folders");
      const request = action === "get" ? store.get(uid) : action === "put" ? store.put(value, uid) : store.delete(uid);
      tx.oncomplete = () => resolve(action === "get" ? request.result ?? null : value ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("FOLDER_STORAGE_ABORTED"));
    });
  } finally { db.close(); }
}
export const readPrescriptionFolder = (uid: string) => accessFolder(uid, "get");
export async function choosePrescriptionFolder(uid: string): Promise<PrescriptionFolder> {
  if (!uid || !folderSupported()) throw new Error("FOLDER_UNSUPPORTED");
  // The picker must be invoked directly from the user's click, before any IndexedDB await.
  const directory = await (window as PickerWindow).showDirectoryPicker!({ mode: "readwrite", id: "medbook-prescriptions" });
  const result = { directory };
  await accessFolder(uid, "put", result);
  window.dispatchEvent(new Event(CHANGED));
  return result;
}
export async function removePrescriptionFolder(uid: string) {
  await accessFolder(uid, "delete");
  window.dispatchEvent(new Event(CHANGED));
}
export function onPrescriptionFolderChanged(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}
/** Call immediately on the print gesture, before PDF generation consumes user activation. */
export async function authorizePrescriptionFolder(folder: PrescriptionFolder): Promise<void> {
  const permission = await folder.directory.queryPermission({ mode: "readwrite" });
  if (permission !== "granted" && await folder.directory.requestPermission({ mode: "readwrite" }) !== "granted")
    throw new Error("FOLDER_PERMISSION_DENIED");
}
export function prescriptionPdfFilename(patientName: string, day: string, unique: string = crypto.randomUUID()): string {
  const name = patientName.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70) || "patient";
  return `MedBook-${day.replace(/[^0-9-]/g, "")}-${name}-${unique.replace(/[^a-zA-Z0-9-]/g, "")}.pdf`;
}
export async function writePrescriptionPdf(folder: PrescriptionFolder, filename: string, pdf: Blob) {
  if (await folder.directory.queryPermission({ mode: "readwrite" }) !== "granted") throw new Error("FOLDER_PERMISSION_DENIED");
  const file = await folder.directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  try { await writable.write(pdf); await writable.close(); }
  catch (error) { await writable.abort().catch(() => undefined); throw error; }
}
