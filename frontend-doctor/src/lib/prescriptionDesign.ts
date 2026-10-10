import type { PrescriptionTemplate } from "./prescriptionTemplate";

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
  logoPosition: "left" | "right";
  headerSize: number;
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
    const logoSize = centered ? 18 : 24;
    const factor = Math.min(logoSize / img.width, logoSize / img.height);
    const w = img.width * factor, h = img.height * factor;
    const x = centered ? (148 - w) / 2 : design.logoPosition === "left" ? 12 : 136 - w;
    ctx.drawImage(img, x, 10, w, h);
    if (centered) y = 10 + h + 5;
    else if (design.logoPosition === "left") start = 42;
    else end = 106;
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
  if (!centered && design.logo) y = Math.max(y, 37);
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
