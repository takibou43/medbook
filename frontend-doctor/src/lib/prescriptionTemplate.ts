import type { PrescriptionDesign } from "./prescriptionDesign";

export interface PrescriptionTemplate {
  design?: PrescriptionDesign | null;
  image: string;
  top: number;
  bottom: number;
  side: number;
}

export interface PrintedFormField { x: number; y: number; width: number }
export type PrintedFormFields = Record<"date" | "patient" | "age", PrintedFormField>;
export const DEFAULT_PRINTED_FORM_FIELDS: PrintedFormFields = {
  date: { x: 24, y: 53, width: 65 },
  patient: { x: 15, y: 65, width: 75 },
  age: { x: 106, y: 60, width: 30 },
};

/** Phone file pickers sometimes omit MIME or use image/jpg; inspect the actual bytes. */
export async function prescriptionImageType(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  throw new Error("صيغة الصورة غير مدعومة. اختر صورة JPEG أو PNG أو WebP فعلية.");
}

/** Only the blank stationery is uploaded; never prescription or patient data. */
export async function readTemplateImage(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("حجم الصورة يتجاوز 10 ميغابايت. اختر نسخة أصغر.");
  const type = await prescriptionImageType(file);
  const url = URL.createObjectURL(new Blob([file], { type }));
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error("تعذّر فتح الصورة. أعد حفظها بصيغة JPEG أو PNG ثم اخترها مجددًا."); }
    if (img.width < 300 || img.height < 400 || img.width * img.height > 40000000 || img.width >= img.height) {
      throw new Error("اختر صورة عمودية واضحة للورقة كاملة (300 × 400 بكسل على الأقل).");
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1480, img.width);
    canvas.height = Math.round(canvas.width * 210 / 148);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذر تجهيز الصورة.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Preserve proportions and the complete sheet; add white space instead of stretching or cropping.
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const width = img.width * scale, height = img.height * scale;
    ctx.drawImage(img, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    let image = canvas.toDataURL("image/jpeg", 0.9);
    for (const quality of [0.8, 0.7, 0.6]) {
      if (image.length <= 1400000) break;
      image = canvas.toDataURL("image/jpeg", quality);
    }
    if (image.length > 1400000) throw new Error("الصورة كبيرة جدًا. اختر صورة أبسط.");
    return image;
  } finally { URL.revokeObjectURL(url); }
}
