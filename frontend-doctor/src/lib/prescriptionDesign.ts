import type { PrescriptionTemplate } from "./prescriptionTemplate";

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

/** Reflow known header fields; retain any extra elements created in advanced mode. */
export function arrangeSimpleHeader(design: PrescriptionDesign, fields: SimplePrescriptionHeader): PrescriptionDesign {
  const item = (id: string, text: string, x: number, y: number, width: number, height: number, fontSize: number, align: DesignElement["align"] = "center"): DesignElement => ({ id, kind: "text", text, x, y, width, height, fontSize, align, font: /[\u0600-\u06ff]/.test(text) ? "Cairo" : "Arial", color: fields.color, bold: id.startsWith("name-") });
  const elements = [item("name-fr", fields.nameFr, 8, 8, 48, 11, 4.3, "left"), item("name-ar", fields.nameAr, 92, 8, 48, 11, 4.3, "right"), { ...item("logo", "", 63, 8, 22, 22, 4), kind: "logo" as const }];
  let y = 20;
  for (const [id, ar, fr, height] of [["specialty", fields.specialty, fields.specialtyFr, 6], ["clinic", fields.clinic, fields.clinicFr, 6]] as const) {
    if (!ar.trim() && !fr.trim()) continue;
    elements.push(item(id + "-fr", fr, 8, y, 48, height, 3.2, "left"), item(id + "-ar", ar, 92, y, 48, height, 3.2, "right"));
    y += height + 1;
  }
  // Contact information belongs below the writing area; leave the central booking QR clear.
  if (fields.addressFr.trim()) elements.push(item("address-fr", fields.addressFr, 92, 176, 48, 12, 3.2, "left"));
  if (fields.address.trim()) elements.push(item("address-ar", fields.address, 92, fields.addressFr.trim() ? 188 : 176, 48, 12, 3.2, "right"));
  if (fields.phone.trim()) elements.push(item("phone", fields.phone, 8, 189, 48, 12, 3.2, "left"));
  if (fields.footer.trim()) elements.push(item("footer", fields.footer, 8, 162, 132, 10, 3.2));
  const managed = new Set(["doctor", "name-ar", "name-fr", "specialty", "clinic", "address", "phone", "footer", "logo", ...["specialty", "clinic", "address", "phone"].flatMap(id => [id + "-ar", id + "-fr"])]);
  const extras = (design.elements ?? []).filter(e => !managed.has(e.id));
  return { ...design, doctorName: fields.nameAr || fields.nameFr || design.doctorName, specialty: fields.specialty || fields.specialtyFr, clinicName: fields.clinic || fields.clinicFr, address: fields.address || fields.addressFr, phone: fields.phone, footer: fields.footer, color: fields.color, logoPosition: "center", elements: [...elements, ...extras], writingArea: { top: Math.min(75, Math.max(34, y + 2)), bottom: 50, side: 10 } };
}

export interface PrescriptionDesign {
  version: 1;
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

async function renderFreeDesign(design: PrescriptionDesign, branding: PrescriptionBranding): Promise<PrescriptionTemplate> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1480; canvas.height = 2100;
  const context = canvas.getContext("2d"); if (!context) throw new Error("تعذر إنشاء القالب.");
  const ctx = context;
  ctx.scale(10, 10); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 148, 210);
  await drawBrandImage(ctx, branding.watermark, 46.5, 77.5, 55, 0.045);
  const logo = design.logo || branding.specialtyLogo;
  for (const e of design.elements ?? []) {
    ctx.save(); ctx.beginPath(); ctx.rect(e.x, e.y, e.width, e.height); ctx.clip();
    if (e.kind === "logo" && logo) {
      const img = new Image(); img.src = logo; await img.decode();
      const ratio = Math.min(e.width / img.width, e.height / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      ctx.drawImage(img, e.x + (e.width - w) / 2, e.y + (e.height - h) / 2, w, h);
    } else if (e.kind === "text") {
      ctx.fillStyle = e.color; ctx.textAlign = e.align; ctx.textBaseline = "top";
      ctx.direction = /[\u0600-\u06ff]/.test(e.text) ? "rtl" : "ltr";
      const x = e.align === "center" ? e.x + e.width / 2 : e.align === "right" ? e.x + e.width : e.x;
      let size = e.fontSize, rows: string[] = [];
      function wrap(): string[] {
        const result: string[] = [];
        for (const paragraph of e.text.split("\n")) {
          let row = "";
          for (const word of paragraph.split(/\s+/)) {
            if (ctx.measureText(word).width > e.width) {
              if (row) { result.push(row); row = ""; }
              for (const char of word) { if (row && ctx.measureText(row + char).width > e.width) { result.push(row); row = ""; } row += char; }
            } else {
              const next = row ? row + " " + word : word;
              if (row && ctx.measureText(next).width > e.width) { result.push(row); row = word; } else row = next;
            }
          }
          result.push(row);
        }
        return result;
      }
      while (true) {
        ctx.font = `${e.bold ? "bold " : ""}${size}px "${e.font}", sans-serif`;
        rows = wrap();
        if ((rows.length - 1) * size * 1.5 + size <= e.height + 0.01) break;
        if (size <= 2.01) throw new Error(design.language === "fr" ? "Raccourcissez les informations de ce champ." : "اختصر معلومات هذا الحقل لتظهر كاملة.");
        size = Math.max(2, size - 0.2);
      }
      rows.forEach((row, i) => ctx.fillText(row, x, e.y + i * size * 1.5));
    }
    ctx.restore();
  }
  // Fixed bilingual stationery gets thin rules like a traditional medical letterhead.
  // Legacy free designs retain their original geometry until explicitly rearranged.
  if (design.elements?.some(e => e.id === "name-ar") && design.elements?.some(e => e.id === "name-fr")) {
    ctx.strokeStyle = design.color; ctx.lineWidth = 0.25;
    for (const y of [(design.writingArea?.top ?? 34) - 3, 173]) {
      ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(140, y); ctx.stroke();
    }
  }
  await drawBrandImage(ctx, branding.bookingQr, 68, 188, 12);
  const image = canvas.toDataURL("image/jpeg", 0.9);
  if (image.length > 1400000) throw new Error("حجم القالب كبير جدًا.");
  return { image, ...(design.writingArea ?? { top: 60, bottom: 30, side: 12 }), design: { ...design } };
}

export async function readPrescriptionLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("اختر صورة PNG أو JPEG أو WebP لا تتجاوز 5 ميغابايت.");
  const url = URL.createObjectURL(file);
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
  await drawBrandImage(ctx, branding.watermark, 46.5, 77.5, 55, 0.045);
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
