import type { PrescriptionTemplate } from "./prescriptionTemplate";
import type { PrintedFormFields } from "./prescriptionTemplate";
import { prescriptionImageType } from "./prescriptionTemplate.ts";
import { medicalSymbolImage } from "./medicalSymbol.ts";

export const PRESCRIPTION_PRESETS = [
  { id: "traditional", ar: "طبي تقليدي", fr: "Médical traditionnel", color: "#1574ad" },
  { id: "classic", ar: "كلاسيكي اقتصادي", fr: "Classique sobre", color: "#303030" },
  { id: "bilingual", ar: "ثنائي اللغة", fr: "Bilingue", color: "#187f77" },
  { id: "centered", ar: "ترويسة وسطية", fr: "En-tête centré", color: "#24476b" },
  { id: "specialty", ar: "بلون التخصص", fr: "Accent spécialité", color: "#187f77" },
] as const;
export type PrescriptionPreset = typeof PRESCRIPTION_PRESETS[number]["id"];

/** Apply a layout to the doctor's own fields; never import demonstration identities. */
export function applyPrescriptionPreset(design: PrescriptionDesign, preset: PrescriptionPreset, names?: { ar?: string; fr?: string }): PrescriptionDesign {
  const fields = readSimpleHeader(design, names);
  const color = PRESCRIPTION_PRESETS.find(p => p.id === preset)!.color;
  return arrangeSimpleHeader({ ...design, source: "generated", preset, color, emblem: preset === "traditional" ? "medical" : design.emblem }, { ...fields, color });
}

export interface DesignElement {
  id: string;
  kind: "text" | "logo";
  text: string;
  x: number; y: number; width: number; height: number;
  fontSize: number;
  font: "Cairo" | "Arial" | "Tahoma";
  color: string;
  bold: boolean;
  align: "left" | "center" | "right";
}

export interface SimplePrescriptionHeader {
  nameAr: string; nameFr: string; specialty: string; specialtyFr: string; clinic: string; clinicFr: string; address: string; addressFr: string; phone: string; footer: string; color: string;
}

export function readSimpleHeader(design: PrescriptionDesign, names?: { ar?: string; fr?: string }): SimplePrescriptionHeader {
  const text = (id: string, fallback = "") => design.elements?.find(e => e.id === id)?.text ?? fallback;
  const oldName = text("doctor", design.doctorName);
  const sideText = (id: string, original: string, ar: boolean) => text(`${id}-${ar ? "ar" : "fr"}`, /[\u0600-\u06ff]/.test(text(id, original)) === ar ? text(id, original) : "");
  return {
    nameAr: text("name-ar", names?.ar ?? (/[\u0600-\u06ff]/.test(oldName) ? oldName : "")),
    nameFr: text("name-fr", names?.fr ?? (!/[\u0600-\u06ff]/.test(oldName) ? oldName : "")),
    specialty: sideText("specialty", design.specialty, true), specialtyFr: sideText("specialty", design.specialty, false),
    clinic: sideText("clinic", design.clinicName, true), clinicFr: sideText("clinic", design.clinicName, false),
    address: sideText("address", design.address, true), addressFr: sideText("address", design.address, false), phone: text("phone", design.phone), footer: text("footer", design.footer), color: design.color,
  };
}

const SIMPLE_HEADER_IDS = new Set(["doctor", "name-ar", "name-fr", "specialty", "clinic", "address", "phone", "footer", "logo", ...["specialty", "clinic", "address", "phone"].flatMap(id => [id + "-ar", id + "-fr"])]);

/** Only automatic stationery on blank paper can be reflowed without moving a custom element or preprinted content. */
export function canBalancePrescriptionDesign(design?: PrescriptionDesign | null): boolean {
  if (design?.source !== "generated" || design.printMode === "preprinted" || !design.elements) return false;
  const managed = SIMPLE_HEADER_IDS;
  return design.elements.some(e => e.id === "name-ar") && design.elements.some(e => e.id === "name-fr") && design.elements.every(e => managed.has(e.id));
}

/** Reflow known header fields; retain any extra elements created in advanced mode. */
export function arrangeSimpleHeader(design: PrescriptionDesign, fields: SimplePrescriptionHeader, measure?: (text: string, size: number, bold: boolean) => number): PrescriptionDesign {
  const item = (id: string, text: string, x: number, y: number, width: number, height: number, fontSize: number, align: DesignElement["align"] = "center"): DesignElement => ({ id, kind: "text", text, x, y, width, height, fontSize, align, font: /[\u0600-\u06ff]/.test(text) ? "Cairo" : "Arial", color: fields.color, bold: id.startsWith("name-") });
  const nameHeight = measure ? Math.max(5, measure(fields.nameAr, 4.8, true), measure(fields.nameFr, 4.8, true)) : 8;
  const elements = [item("name-fr", fields.nameFr, 8, 8, 48, nameHeight, 4.8, "left"), item("name-ar", fields.nameAr, 92, 8, 48, nameHeight, 4.8, "right"), { ...item("logo", "", 59, 7, 30, 24, 4), kind: "logo" as const }];
  let y = 8 + nameHeight + 1;
  for (const [id, ar, fr] of [["specialty", fields.specialty, fields.specialtyFr], ["clinic", fields.clinic, fields.clinicFr]] as const) {
    if (!ar.trim() && !fr.trim()) continue;
    const height = measure ? Math.max(5, measure(ar, 4.8, false), measure(fr, 4.8, false)) : 6;
    elements.push(item(id + "-fr", fr, 8, y, 48, height, 4.8, "left"), item(id + "-ar", ar, 92, y, 48, height, 4.8, "right"));
    y += height + 1;
  }
  if (design.preset === "centered") {
    // Two language columns remain separate, with the logo above and centred text below.
    const offset = 21;
    for (const e of elements) {
      if (e.kind === "logo") { e.x = 65; e.y = 6; e.width = 18; e.height = 18; }
      else { e.y += offset; e.align = "center"; e.width = 62; e.x = e.id.endsWith("-ar") ? 78 : 8; }
    }
    y += offset;
  }
  if (design.preset === "traditional") {
    const logo = elements.find(e => e.kind === "logo")!;
    logo.x = 61; logo.y = 6; logo.width = 26; logo.height = 32;
    y = Math.max(y, 38);
  }
  // Contact information belongs below the writing area; leave the central booking QR clear.
  if (fields.addressFr.trim()) elements.push(item("address-fr", fields.addressFr, 92, 192, 48, 12, 4.8, "right"));
  if (fields.address.trim()) elements.push(item("address-ar", fields.address, 92, 192, 48, 12, 4.8, "right"));
  if (fields.phone.trim()) elements.push(item("phone", fields.phone, 8, 192, 48, 12, 4.8, "left"));
  if (fields.footer.trim()) elements.push(item("footer", fields.footer, 8, 180, 132, 8, 3.2));
  const managed = SIMPLE_HEADER_IDS;
  const extras = (design.elements ?? []).filter(e => !managed.has(e.id));
  return { ...design, doctorName: fields.nameAr || fields.nameFr || design.doctorName, specialty: fields.specialty || fields.specialtyFr, clinicName: fields.clinic || fields.clinicFr, address: fields.address || fields.addressFr, phone: fields.phone, footer: fields.footer, color: fields.color, layout: design.preset === "centered" ? "centered" : "split", logoPosition: "center", elements: [...elements, ...extras], writingArea: { top: Math.ceil(Math.min(75, Math.max(37, y + 5))), bottom: fields.footer.trim() ? 40 : 25, side: 10 } };
}

export interface PrescriptionDesign {
  version: 1;
  preset?: PrescriptionPreset;
  emblem?: "medical" | "specialty" | "none";
  formFields?: PrintedFormFields;
  source?: "image" | "generated";
  printMode?: "blank" | "preprinted";
  language: "ar" | "fr";
  doctorName: string;
  specialty: string;
  clinicName: string;
  address: string;
  phone: string;
  footer: string;
  color: string;
  layout: "centered" | "split";
  logo: string | null;
  logoPosition: "left" | "right" | "center";
  logoSize?: number;
  logoTop?: number;
  headerSize: number;
  elements?: DesignElement[];
  writingArea?: { top: number; bottom: number; side: number };
}

export function initialDesignElements(design: PrescriptionDesign): DesignElement[] {
  if (design.elements) return design.elements;
  const make = (id: string, text: string, y: number, size = 4): DesignElement => ({ id, kind: "text", text, x: 42, y, width: 94, height: size * 1.5, fontSize: size, font: design.language === "ar" ? "Cairo" : "Arial", color: design.color, bold: id === "doctor", align: design.language === "ar" ? "right" : "left" });
  return [make("doctor", design.doctorName, 10, 6), make("specialty", design.specialty, 21), make("clinic", design.clinicName, 30), make("address", design.address, 39), make("phone", design.phone, 48), { ...make("footer", design.footer, 191), x: 12, width: 124, align: "center" as const }, ...(design.logo ? [{ ...make("logo", "", 10), kind: "logo" as const, x: 12, width: 24, height: 24 }] : [])].filter(e => e.kind === "logo" || e.text.trim());
}

export function overlapsWritingArea(element: DesignElement, area: { top: number; bottom: number; side: number }): boolean {
  return element.x < 148 - area.side && element.x + element.width > area.side && element.y < 210 - area.bottom && element.y + element.height > area.top;
}

export interface PrescriptionBranding { specialtyLogo?: string; watermark?: string; bookingQr?: string }

async function drawBrandImage(ctx: CanvasRenderingContext2D, src: string | undefined, x: number, y: number, size: number, opacity = 1) {
  if (!src) return;
  const img = new Image(); img.src = src; await img.decode();
  ctx.save(); ctx.globalAlpha = opacity; ctx.drawImage(img, x, y, size, size); ctx.restore();
}

/** Fit the visible logo, rather than its surrounding white/transparent canvas, into the header slot. */
async function drawContainedLogo(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, width: number, height: number) {
  const img = new Image(); img.src = src; await img.decode();
  let crop: { x: number; y: number; width: number; height: number } | null = null;
  try {
    const scan = document.createElement("canvas");
    const scale = Math.min(1, 512 / Math.max(img.width, img.height));
    scan.width = Math.max(1, Math.round(img.width * scale)); scan.height = Math.max(1, Math.round(img.height * scale));
    const pixels = scan.getContext("2d");
    if (pixels?.getImageData) {
      pixels.drawImage(img, 0, 0, scan.width, scan.height);
      const rgba = pixels.getImageData(0, 0, scan.width, scan.height).data;
      let left = scan.width, top = scan.height, right = -1, bottom = -1;
      for (let py = 0; py < scan.height; py++) for (let px = 0; px < scan.width; px++) {
        const i = (py * scan.width + px) * 4;
        if (rgba[i + 3] > 24 && Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < 240) {
          left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py);
        }
      }
      if (right >= left && bottom >= top) {
        left = Math.max(0, left - 2); top = Math.max(0, top - 2);
        right = Math.min(scan.width - 1, right + 2); bottom = Math.min(scan.height - 1, bottom + 2);
        crop = { x: left / scale, y: top / scale, width: (right - left + 1) / scale, height: (bottom - top + 1) / scale };
      }
    }
  } catch { /* Preserve an unreadable or cross-origin logo without cropping it. */ }
  const contentWidth = crop?.width ?? img.width, contentHeight = crop?.height ?? img.height;
  const ratio = Math.min(width / contentWidth, height / contentHeight);
  const w = contentWidth * ratio, h = contentHeight * ratio;
  const dx = x + (width - w) / 2, dy = y + (height - h) / 2;
  if (crop) ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, dx, dy, w, h);
  else ctx.drawImage(img, dx, dy, w, h);
}

function wrappedRows(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    let row = "";
    for (const word of paragraph.split(/\s+/)) {
      if (ctx.measureText(word).width > width) {
        if (row) { result.push(row); row = ""; }
        for (const char of word) { if (row && ctx.measureText(row + char).width > width) { result.push(row); row = ""; } row += char; }
      } else {
        const next = row ? row + " " + word : word;
        if (row && ctx.measureText(next).width > width) { result.push(row); row = word; } else row = next;
      }
    }
    result.push(row);
  }
  return result;
}

async function renderFreeDesign(design: PrescriptionDesign, branding: PrescriptionBranding): Promise<PrescriptionTemplate> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1480; canvas.height = 2100;
  const context = canvas.getContext("2d"); if (!context) throw new Error("تعذر إنشاء القالب.");
  const ctx = context;
  if (canBalancePrescriptionDesign(design)) {
    design = arrangeSimpleHeader(design, readSimpleHeader(design), (text, size, bold) => {
      ctx.font = `${bold ? "bold " : ""}${size}px "${/[\u0600-\u06ff]/.test(text) ? "Cairo" : "Arial"}", sans-serif`;
      return Math.max(size + 0.5, (wrappedRows(ctx, text, 48).length - 1) * size * 1.5 + size + 0.5);
    });
    const headerBottom = Math.max(...design.elements!.filter(e => ["name-ar", "name-fr", "specialty-ar", "specialty-fr", "clinic-ar", "clinic-fr"].includes(e.id)).map(e => e.y + e.height));
    if (headerBottom > 70) throw new Error("اختصر معلومات الترويسة لتبقى مساحة كافية للوصفة.");
  }
  ctx.scale(10, 10); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 148, 210);
  if (design.preset === "specialty") {
    ctx.fillStyle = design.color;
    ctx.fillRect(8, 3, 132, 1.5);
    ctx.save(); ctx.globalAlpha = 0.06;
    ctx.fillRect(8, 5, 132, Math.max(0, (design.writingArea?.top ?? 37) - 8)); ctx.restore();
  }
  if (design.preset === "traditional") {
    ctx.save(); ctx.globalAlpha = 0.055;
    await drawContainedLogo(ctx, medicalSymbolImage(design.color), 38, 80, 72, 86); ctx.restore();
  } else if (design.preset !== "classic") await drawBrandImage(ctx, branding.watermark, 39, 70, 70, 0.12);
  if (branding.watermark && design.preset !== "classic") {
    ctx.save(); ctx.globalAlpha = design.preset === "traditional" ? 0.08 : 0.16; ctx.fillStyle = "#303030";
    ctx.font = design.preset === "traditional" ? '3px "Cairo", Arial, sans-serif' : 'bold 5px "Cairo", Arial, sans-serif'; ctx.textAlign = "center";
    ctx.textBaseline = "top"; ctx.direction = "ltr";
    ctx.fillText("MedBook | مادبوك", 74, 143); ctx.restore();
  }
  const logo = design.logo || (design.emblem === "none" ? undefined : design.emblem === "medical" ? medicalSymbolImage(design.color) : branding.specialtyLogo);
  const automaticFooter = canBalancePrescriptionDesign(design);
  const preferredAddress = design.elements?.find(e => e.id === `address-${design.language}` && e.text.trim());
  const footerAddressId = preferredAddress?.id ?? design.elements?.find(e => e.id.startsWith("address-") && e.text.trim())?.id;
  for (const e of design.elements ?? []) {
    // Keep both saved address fields, but print only the prescription's language in the footer row.
    if (automaticFooter && e.id.startsWith("address-") && e.id !== footerAddressId) continue;
    ctx.save(); ctx.beginPath(); ctx.rect(e.x, e.y, e.width, e.height); ctx.clip();
    if (e.kind === "logo" && logo) {
      await drawContainedLogo(ctx, logo, e.x, e.y, e.width, e.height);
    } else if (e.kind === "text") {
      ctx.fillStyle = automaticFooter && (e.id === "phone" || e.id.startsWith("address-")) ? "#303030" : e.color; ctx.textAlign = e.align; ctx.textBaseline = "top";
      ctx.direction = /[\u0600-\u06ff]/.test(e.text) ? "rtl" : "ltr";
      const x = e.align === "center" ? e.x + e.width / 2 : e.align === "right" ? e.x + e.width : e.x;
      let size = e.fontSize, rows: string[] = [];
      while (true) {
        ctx.font = `${e.bold ? "bold " : ""}${size}px "${e.font}", sans-serif`;
        rows = wrappedRows(ctx, e.text, e.width);
        if ((rows.length - 1) * size * 1.5 + size <= e.height + 0.01) break;
        if (size <= 2.01) throw new Error(design.language === "fr" ? "Raccourcissez les informations de ce champ." : "اختصر معلومات هذا الحقل لتظهر كاملة.");
        size = Math.max(2, size - 0.2);
      }
      const contact = e.id === "phone" || e.id.startsWith("address-");
      const textHeight = (rows.length - 1) * size * 1.5 + size;
      const textTop = e.y + (contact ? Math.max(0, (e.height - textHeight) / 2) : 0);
      rows.forEach((row, i) => ctx.fillText(row, x, textTop + i * size * 1.5));
    }
    ctx.restore();
  }
  // Fixed bilingual stationery gets thin rules like a traditional medical letterhead.
  // Legacy free designs retain their original geometry until explicitly rearranged.
  if (design.elements?.some(e => e.id === "name-ar") && design.elements?.some(e => e.id === "name-fr")) {
    ctx.strokeStyle = design.color; ctx.lineWidth = 0.25;
    for (const y of [(design.writingArea?.top ?? 34) - 3, automaticFooter ? 189 : 183]) {
      ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(140, y); ctx.stroke();
    }
  }
  await drawBrandImage(ctx, branding.bookingQr, 68, automaticFooter ? 192 : 188, 12);
  const image = canvas.toDataURL("image/jpeg", 0.9);
  if (image.length > 1400000) throw new Error("حجم القالب كبير جدًا.");
  return { image, ...(design.writingArea ?? { top: 60, bottom: 30, side: 12 }), design: { ...design } };
}

export async function readPrescriptionLogo(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("اختر صورة PNG أو JPEG أو WebP لا تتجاوز 5 ميغابايت.");
  const type = await prescriptionImageType(file);
  const url = URL.createObjectURL(new Blob([file], { type }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    if (!img.width || !img.height || img.width * img.height > 40000000) throw new Error("أبعاد الشعار غير صالحة.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 360 / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("تعذر تجهيز الشعار.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/png");
    if (result.length > 400000) throw new Error("الشعار كبير جدًا. اختر صورة أبسط.");
    return result;
  } finally { URL.revokeObjectURL(url); }
}

/** Draws blank stationery only. Prescription content never enters this canvas or the saved design. */
export async function renderPrescriptionDesign(design: PrescriptionDesign, branding: PrescriptionBranding = {}): Promise<PrescriptionTemplate> {
  if (design.elements) return renderFreeDesign(design, branding);
  if (!design.doctorName.trim()) throw new Error(design.language === "fr" ? "Saisissez le nom du médecin." : "أدخل اسم الطبيب.");
  await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1480; canvas.height = 2100;
  const context = canvas.getContext("2d"); if (!context) throw new Error("تعذر إنشاء القالب.");
  const ctx = context;
  ctx.scale(10, 10); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 148, 210);
  await drawBrandImage(ctx, branding.watermark, 39, 70, 70, 0.12);
  if (branding.watermark) {
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = "#303030";
    ctx.font = 'bold 5px "Cairo", Arial, sans-serif'; ctx.textAlign = "center";
    ctx.textBaseline = "top"; ctx.direction = "ltr";
    ctx.fillText("MedBook | مادبوك", 74, 143); ctx.restore();
  }
  ctx.direction = design.language === "ar" ? "rtl" : "ltr";
  const font = design.language === "ar" ? '"Cairo", Tahoma, sans-serif' : 'Arial, sans-serif';
  const centered = design.layout === "centered";
  let start = 12, end = 136, y = 13;
  if (design.logo) {
    const img = new Image(); img.src = design.logo; await img.decode();
    const logoSize = Math.min(40, Math.max(10, design.logoSize ?? (centered ? 18 : 24)));
    const logoTop = Math.min(20, Math.max(5, design.logoTop ?? 10));
    const factor = Math.min(logoSize / img.width, logoSize / img.height);
    const w = img.width * factor, h = img.height * factor;
    const x = design.logoPosition === "center" ? (148 - w) / 2 : design.logoPosition === "left" ? 12 : 136 - w;
    ctx.drawImage(img, x, logoTop, w, h);
    if (centered || design.logoPosition === "center") y = logoTop + h + 5;
    else if (design.logoPosition === "left") start = 12 + w + 6;
    else end = 136 - w - 6;
  }
  const align: CanvasTextAlign = centered ? "center" : design.language === "ar" ? "right" : "left";
  const x = centered ? 74 : align === "right" ? end : start;
  ctx.textAlign = align;
  function line(text: string, size: number, bold = false) {
    if (!text.trim()) return;
    ctx.font = `${bold ? "bold " : ""}${size}px ${font}`;
    const words = text.trim().split(/\s+/); let row = "";
    for (const word of words) {
      if (ctx.measureText(word).width > end - start) throw new Error(design.language === "fr" ? "Un mot est trop long pour l’en-tête." : "توجد كلمة طويلة جدًا لا تتسع في الترويسة.");
      const next = row ? `${row} ${word}` : word;
      if (row && ctx.measureText(next).width > end - start) { ctx.fillText(row, x, y); y += size * 1.6; row = word; }
      else row = next;
    }
    if (row) { ctx.fillText(row, x, y); y += size * 1.6; }
  }
  ctx.fillStyle = design.color;
  line(design.doctorName, design.headerSize / 3, true);
  ctx.fillStyle = "#1f2937";
  for (const text of [design.specialty, design.clinicName, design.address, design.phone]) line(text, 3.6);
  if (design.logo) y = Math.max(y, (design.logoTop ?? 10) + (design.logoSize ?? (centered ? 18 : 24)) + 3);
  const top = Math.ceil(y + 7);
  if (top > 75) throw new Error(design.language === "fr" ? "L’en-tête est trop haut. Réduisez le texte, la taille ou choisissez la disposition latérale." : "الترويسة كبيرة. اختصر النص أو صغّر حجمه أو اختر التخطيط الجانبي.");
  ctx.strokeStyle = design.color; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(136, y); ctx.stroke();
  ctx.font = `3.2px ${font}`; ctx.textAlign = "center"; ctx.fillStyle = "#374151";
  const footerWords = design.footer.trim().split(/\s+/).filter(Boolean); const rows: string[] = []; let row = "";
  for (const word of footerWords) {
    if (ctx.measureText(word).width > 124) throw new Error(design.language === "fr" ? "Un mot du pied de page est trop long." : "توجد كلمة طويلة جدًا في تذييل الورقة.");
    const next = row ? `${row} ${word}` : word;
    if (row && ctx.measureText(next).width > 124) { rows.push(row); row = word; } else row = next;
  }
  if (row) rows.push(row);
  if (rows.length > 3) throw new Error(design.language === "fr" ? "Limitez le pied de page à trois lignes." : "اختصر التذييل ليظهر في ثلاثة أسطر كحد أقصى.");
  const bottom = 10 + rows.length * 5;
  ctx.strokeStyle = design.color; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(12, 197 - rows.length * 5); ctx.lineTo(136, 197 - rows.length * 5); ctx.stroke();
  rows.forEach((text, i) => ctx.fillText(text, 74, 202 - (rows.length - i - 1) * 5));
  await drawBrandImage(ctx, branding.bookingQr, 68, 188, 12);
  const image = canvas.toDataURL("image/jpeg", 0.9);
  if (image.length > 1400000) throw new Error("حجم القالب كبير جدًا.");
  return { image, top, bottom, side: 12, design: { ...design } };
}
