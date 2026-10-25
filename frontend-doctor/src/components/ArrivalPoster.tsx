import { arrivalQrUrl, bookingQrImage } from "../lib/doctorBooking";
import { t } from "../i18n/locale";
import { useLanguage } from "../i18n/LanguageRoot";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import qrcode from "qrcode-generator";
import { api } from "../lib/api";

export function ArrivalPoster({ clinic }: { clinic?: { id: string; nameAr: string } } = {}) {
  useLanguage();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useQuery({ queryKey: ['arrival-poster', clinic?.id ?? 'doctor'], enabled: open,
    queryFn: async () => (await api.get(clinic ? '/clinics/mine/arrival-poster' : '/appointments/arrival-poster')).data.data as { code: string; doctorId?: string; name: string } });
  function print() {
    if (!data) return;
    const qr = qrcode(0, 'M'); qr.addData(arrivalQrUrl(data.code)); qr.make();
    const popup = window.open('', '_blank', 'width=640,height=800');
    if (!popup) return;
    popup.document.write('<!doctype html><html dir="rtl"><meta charset="utf-8"><title>كود حضور مادبوك</title><body style="text-align:center;font-family:Arial;padding:40px"><h1 id="clinic"></h1>' + qr.createSvgTag({ cellSize: 8, margin: 32 }) + '<h2>سجّل حضورك هنا</h2><p>امسح بكاميرا الهاتف أو بأيقونة الكاميرا في مادبوك</p><p>وجّه كاميرا التطبيق نحو هذا الكود</p></body></html>');
    popup.document.close();
    popup.document.getElementById('clinic')!.textContent = data.name;
    popup.focus(); popup.print();
  }
  return <div className="min-w-0 rounded-xl border bg-white/80 px-3">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} className="min-h-11 text-sm font-semibold text-primary-700">{t("كود الحضور والحجز")} <span aria-hidden="true">{open ? "−" : "+"}</span></button>
    {open && <div id={panelId} className="max-w-sm space-y-3 pb-3 text-sm">{isPending ? t("جارٍ التحميل…") : isError ? t("تعذر تحميل الكود. أعد المحاولة.") : data && <>
      <p>{t("يرجى إعادة طباعة الملصق بعد التحديث. كود الحجز العام لا يسجل الحضور.")}</p>
      <p>{t("امسح الكود عند الوصول: إذا كان لديك موعد اليوم يُسجل حضورك لدى طبيبك، وإلا تظهر أطباء العيادة للحجز. المستخدم الجديد يسجل أولًا.")}</p>
      <img src={bookingQrImage(arrivalQrUrl(data.code))} width={192} height={192} alt={t("كود الحضور والحجز")} />
      <button onClick={print} className="rounded-lg bg-teal-700 px-3 py-2 text-white">{t("طباعة QR")} — {data.name}</button>
    </>}</div>}
  </div>;
}
