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

/** Attendance uses a server-signed capability, never the public booking UUID. */
export function arrivalQrUrl(code: string, site = "https://medbook-alpha.vercel.app"): string {
  const match = /^medbook-arrival:v2:(clinic|doctor):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[0-9a-f]{32}$/.exec(code);
  if (!match) throw new Error("Invalid arrival code");
  const url = new URL(doctorBookingUrl(match[2].toLowerCase(), site)!);
  url.pathname = '/account/arrival'; url.search = '';
  url.searchParams.set('code', code);
  return url.toString();
}

export function bookingQrImage(url: string): string {
  const qr = qrcode(0, "M"); qr.addData(url); qr.make();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }))}`;
}
