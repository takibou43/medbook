export interface PrescriptionTemplate {
  image: string;
  top: number;
  bottom: number;
  side: number;
}

/** Only the blank stationery is uploaded; never prescription or patient data. */
export async function readTemplateImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error("اختر صورة PNG أو JPEG أو WebP لا تتجاوز 5 ميغابايت.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.width < 500 || img.height < 700 || img.width * img.height > 40000000 || Math.abs(img.width / img.height - 148 / 210) > 0.06) {
      throw new Error("اختر صورة واضحة للورقة كاملة، عمودية بنسبة A5، دون حواف خارجية.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1480, img.width);
    canvas.height = Math.round(canvas.width * 210 / 148);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذر تجهيز الصورة.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.9);
    if (image.length > 1400000) throw new Error("الصورة كبيرة جدًا. اختر صورة أبسط.");
    return image;
  } finally { URL.revokeObjectURL(url); }
}
