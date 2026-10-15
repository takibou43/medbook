/** Produce a local A5 PDF from the same DOM sheet as the preview; no server upload. */
export function pdfPageEnds(height: number, capacity: number, blocks: { top: number; bottom: number }[]): number[] {
  const ends: number[] = [];
  let offset = 0;
  while (offset < height) {
    let end = Math.min(height, offset + capacity);
    // Keep medication/request blocks together whenever a block fits on one page.
    for (const block of [...blocks].sort((a, b) => b.top - a.top)) {
      if (block.top > offset && block.top < end && block.bottom > end && block.bottom - block.top <= capacity) end = block.top;
    }
    if (end <= offset) end = Math.min(height, offset + capacity);
    ends.push(end); offset = end;
  }
  return ends;
}
export async function createPrescriptionPdf(paper: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  await document.fonts.ready;
  const width = 148 * 96 / 25.4;
  if (paper.offsetHeight > 20000) throw new Error("PRESCRIPTION_TOO_LONG");
  let blocks: { top: number; bottom: number }[] = [];
  const canvas = await html2canvas(paper, {
    scale: 3, foreignObjectRendering: true, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: Math.max(1024, window.innerWidth),
    onclone: (doc, element) => {
      doc.body.appendChild(element);
      Object.assign(element.style, { transform: "none", position: "absolute", left: "0", top: "0", width: `${width}px`, margin: "0", boxShadow: "none" });
      const origin = element.getBoundingClientRect();
      blocks = [...element.querySelectorAll(".rx-med, .rx-meta, .rx-header, .rx-request")].map(el => {
        const rect = el.getBoundingClientRect(); return { top: Math.floor((rect.top - origin.top) * 3), bottom: Math.ceil((rect.bottom - origin.top) * 3) };
      });
    },
  });
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
