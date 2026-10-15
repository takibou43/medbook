/** Produce a local A5 PDF from the same DOM sheet as the preview; no server upload. */
export function pdfPageEnds(height: number, capacity: number, blocks: { top: number; bottom: number }[]): number[] {
  const ends: number[] = [];
  let offset = 0;
  while (offset < height) {
    let end = Math.min(height, offset + capacity);
    // Keep medication/request blocks together whenever a block fits on one page.
    // Pick the block crossing the proposed boundary once. Rounding can overlap
    // adjacent boxes by one pixel; walking backwards would otherwise create a page per item.
    const crossing = blocks.find(block => block.top > offset && block.top < end - 2 && block.bottom > end + 2 && block.bottom - block.top <= capacity);
    if (crossing) end = Math.floor(crossing.top);
    if (end <= offset) end = Math.min(height, offset + capacity);
    ends.push(end); offset = end;
  }
  return ends;
}
/** Some browsers resolve foreignObject SVG captures successfully but paint only white. */
export function isBlankPdfCanvas(canvas: HTMLCanvasElement): boolean {
  if (!canvas.width || !canvas.height) return true;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF_CANVAS_UNAVAILABLE");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] && (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250)) return false;
  }
  return true;
}
export async function createPrescriptionPdf(paper: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  await document.fonts.ready;
  const width = 148 * 96 / 25.4;
  if (paper.offsetHeight > 20000) throw new Error("PRESCRIPTION_TOO_LONG");
  let blocks: { top: number; bottom: number }[] = [];
  await Promise.all(Array.from(paper.querySelectorAll("img")).map(image => image.decode()));
  const capture = (foreignObjectRendering: boolean) => html2canvas(paper, {
    scale: 3, foreignObjectRendering, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: Math.max(1024, window.innerWidth),
    onclone: (doc, element) => {
      doc.body.appendChild(element);
      Object.assign(element.style, { transform: "none", position: "absolute", left: "0", top: "0", width: `${width}px`, margin: "0", boxShadow: "none" });
      // The canvas renderer draws spaced Arabic glyphs separately; retain connected words.
      if (!foreignObjectRendering) element.querySelectorAll<HTMLElement>(".rx-title").forEach(title => { title.style.letterSpacing = "0"; });
      const origin = element.getBoundingClientRect();
      blocks = [...element.querySelectorAll(".rx-med, .rx-meta, .rx-header, .rx-request")].map(el => {
        const rect = el.getBoundingClientRect(); return { top: Math.floor((rect.top - origin.top) * 3), bottom: Math.ceil((rect.bottom - origin.top) * 3) };
      });
    },
  });
  // SVG foreignObject is more faithful for mixed Arabic/French text, but can silently
  // produce an all-white image. Retry with the independent canvas renderer.
  let canvas: HTMLCanvasElement;
  try { canvas = await capture(true); }
  catch { canvas = await capture(false); }
  if (isBlankPdfCanvas(canvas)) canvas = await capture(false);
  if (isBlankPdfCanvas(canvas)) throw new Error("PDF_EMPTY_RENDER");
  const pdf = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait", compress: true });
  const mmPerPixel = 148 / canvas.width;
  // Preserve the full A5 canvas, including its stationery and footer.
  const capacity = Math.round(210 / mmPerPixel);
  const ends = pdfPageEnds(canvas.height, capacity, blocks);
  let offset = 0;
  for (const [index, end] of ends.entries()) {
    if (index) pdf.addPage("a5", "portrait");
    const slice = document.createElement("canvas");
    slice.width = canvas.width; slice.height = end - offset;
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("PDF_CANVAS_UNAVAILABLE");
    ctx.drawImage(canvas, 0, offset, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, 148, slice.height * mmPerPixel);
    offset = end;
  }
  return pdf.output("blob");
}
