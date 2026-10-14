import qrcode from "qrcode-generator";

/** Public booking route already used by the patient app; no patient or access tokens. */
export function doctorBookingUrl(doctorId: string | null | undefined, site = "https://medbook-alpha.vercel.app"): string | null {
  if (!doctorId?.trim()) return null;
  const url = new URL(site);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid patient site URL");
  url.pathname = "/"; url.search = ""; url.hash = "";
  url.searchParams.set("doctor", doctorId.trim());
  return url.toString();
}

export function bookingQrImage(url: string): string {
  const qr = qrcode(0, "M"); qr.addData(url); qr.make();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }))}`;
}
