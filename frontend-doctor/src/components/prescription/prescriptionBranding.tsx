import { renderToStaticMarkup } from "react-dom/server";
import { SpecialtyIcon } from "../../lib/specialtyIcons";
import { Logo } from "../ui/Logo";
import { bookingQrImage, doctorBookingUrl } from "../../lib/doctorBooking";
import type { Doctor } from "../../types";
import type { PrescriptionBranding } from "../../lib/prescriptionDesign";

function svgImage(markup: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" style="color:#187f77" '))}`;
}

export function prescriptionBranding(doctor?: Doctor | null): PrescriptionBranding {
  const url = doctorBookingUrl(doctor?.id, import.meta.env?.VITE_MAIN_SITE_URL || undefined);
  return {
    specialtyLogo: svgImage(renderToStaticMarkup(<SpecialtyIcon specialty={doctor?.specialty ?? {}} />)),
    // Logo already declares xmlns, so avoid a duplicate XML attribute.
    watermark: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderToStaticMarkup(<Logo />).replace('<svg ', '<svg width="360" height="360" '))}`,
    bookingQr: url ? bookingQrImage(url) : undefined,
  };
}
