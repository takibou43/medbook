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
  nameAr: string; nameFr: string; specialty: string; clinic: string; address: string; phone: string; footer: string; color: string;
}

export function readSimpleHeader(design: PrescriptionDesign, names?: { ar?: string; fr?: string }): SimplePrescriptionHeader {
  const text = (id: string, fallback = "") => design.elements?.find(e => e.id === id)?.text ?? fallback;
  const oldName = text("doctor", design.doctorName);
  return {
    nameAr: text("name-ar", names?.ar ?? (/[\u0600-\u06ff]/.test(oldName) ? oldName : "")),
    nameFr: text("name-fr", names?.fr ?? (!/[\u0600-\u06ff]/.test(oldName) ? oldName : "")),
    specialty: text("specialty", design.specialty), clinic: text("clinic", design.clinicName),
    address: text("address", design.address), phone: text("phone", design.phone), footer: text("footer", design.footer), color: design.color,
  };
}

/** Reflow known header fields; retain any extra elements created in advanced mode. */
export function arrangeSimpleHeader(design: PrescriptionDesign, fields: SimplePrescriptionHeader): PrescriptionDesign {
  const item = (id: string, text: string, x: number, y: number, width: number, height: number, fontSize: number, align: DesignElement["align"] = "center"): DesignElement => ({ id, kind: "text", text, x, y, width, height, fontSize, align, font: /[\u0600-\u06ff]/.test(text) ? "Cairo" : "Arial", color: fields.color, bold: id.startsWith("name-") });
  const elements = [item("name-fr", fields.nameFr, 8, 10, 43, 20, 4.5, "left"), item("name-ar", fields.nameAr, 97, 10, 43, 20, 4.5, "right")];
  if (design.logo) elements.push({ ...item("logo", "", 56, 8, 36, 24, 4), kind: "logo" });
  let y = 36;
  for (const [id, text] of [["specialty", fields.specialty], ["clinic", fields.clinic], ["address", fields.address], ["phone", fields.phone]]) {
    if (!text.trim()) continue;
    const height = id === "address" ? 10 : 6;
    elements.push(item(id, text, 8, y, 132, height, 3.4)); y += height + 2;
  }
  if (fields.footer.trim()) elements.push(item("footer", fields.footer, 8, 191, 132, 12, 3.2));
  const managed = new Set(["doctor", "name-ar", "name-fr", "specialty", "clinic", "address", "phone", "footer", "logo"]);
  const extras = (design.elements ?? []).filter(e => !managed.has(e.id) && e.kind !== "logo");
  return { ...design, doctorName: fields.nameAr || fields.nameFr || design.doctorName, specialty: fields.specialty, clinicName: fields.clinic, address: fields.address, phone: fields.phone, footer: fields.footer, color: fields.color, logoPosition: "center", elements: [...elements, ...extras], writingArea: { top: Math.min(75, Math.max(45, y + 3)), bottom: 20, side: 10 } };
}

export interface PrescriptionDesign {
  version: 1;
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

async function renderFreeDesign(design: PrescriptionDesign): Promise<PrescriptionTemplate> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1480; canvas.height = 2100;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("تعذر إنشاء القالب.");
  ctx.scale(10, 10); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 148, 210);
  for (const e of design.elements ?? []) {
    ctx.save(); ctx.beginPath(); ctx.rect(e.x, e.y, e.width, e.height); ctx.clip();
    if (e.kind === "logo" && design.logo) {
      const img = new Image(); img.src = design.logo; await img.decode();
      const ratio = Math.min(e.width / img.width, e.height / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      ctx.drawImage(img, e.x + (e.width - w) / 2, e.y + (e.height - h) / 2, w, h);
    } else if (e.kind === "text") {
      ctx.font = `${e.bold ? "bold " : ""}${e.fontSize}px "${e.font}", sans-serif`;
      ctx.fillStyle = e.color; ctx.textAlign = e.align; ctx.textBaseline = "top";
      ctx.direction = /[\u0600-\u06ff]/.test(e.text) ? "rtl" : "ltr";
      const x = e.align === "center" ? e.x + e.width / 2 : e.align === "right" ? e.x + e.width : e.x;
      let y = e.y;
      for (const paragraph of e.text.split("\n")) {
        let row = "";
        for (const word of paragraph.split(/\s+/)) {
          const next = row ? `${row} ${word}` : word;
          if (ctx.measureText(word).width > e.width) throw new Error(design.language === "fr" ? "Élargissez le cadre du texte ou réduisez la police." : "وسّع مربع النص أو صغّر الخط حتى تظهر الكلمات كاملة.");
          if (row && ctx.measureText(next).width > e.width) { ctx.fillText(row, x, y); y += e.fontSize * 1.5; row = word; }
          else row = next;
        }
        if (y + e.fontSize > e.y + e.height + 0.01) throw new Error(design.language === "fr" ? "Agrandissez le cadre pour afficher tout le texte." : "كبّر مربع النص حتى يظهر النص كاملًا.");
        ctx.fillText(row, x, y); y += e.fontSize * 1.5;
      }
    }
    ctx.restore();
  }
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
export async function renderPrescriptionDesign(design: PrescriptionDesign): Promise<PrescriptionTemplate> {
  if (design.elements) return renderFreeDesign(design);
  if (!design.doctorName.trim()) throw new Error(design.language === "fr" ? "Saisissez le nom du médecin." : "أدخل اسم الطبيب.");
  await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1480; canvas.height = 2100;
  const context = canvas.getContext("2d"); if (!context) throw new Error("تعذر إنشاء القالب.");
  const ctx = context;
  ctx.scale(10, 10); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 148, 210);
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
  const bottom = 23 + rows.length * 5;
  ctx.fillText(design.language === "fr" ? "Signature du médecin / Cachet" : "توقيع الطبيب / الختم", 74, 210 - bottom + 4);
  ctx.strokeStyle = design.color; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(12, 197 - rows.length * 5); ctx.lineTo(136, 197 - rows.length * 5); ctx.stroke();
  rows.forEach((text, i) => ctx.fillText(text, 74, 202 - (rows.length - i - 1) * 5));
  const image = canvas.toDataURL("image/jpeg", 0.9);
  if (image.length > 1400000) throw new Error("حجم القالب كبير جدًا.");
  return { image, top, bottom, side: 12, design: { ...design } };
}
