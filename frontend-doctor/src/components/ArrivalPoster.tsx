import { arrivalQrUrl } from "../lib/doctorBooking";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import qrcode from "qrcode-generator";
import { api } from "../lib/api";

export function ArrivalPoster() {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useQuery({ queryKey: ['arrival-poster'], enabled: open,
    queryFn: async () => (await api.get('/appointments/arrival-poster')).data.data as { code: string; doctorId: string; name: string } });
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
  return <div className="rounded-xl border bg-white p-3" dir="rtl">
    <button onClick={() => setOpen(!open)} className="font-semibold">كود العيادة للحضور والحجز</button>
    {open && <div className="mt-2">{isPending ? 'جارٍ التحميل…' : isError ? 'تعذر تحميل الكود. أعد المحاولة.' : <button onClick={print} className="rounded-lg bg-teal-700 px-3 py-2 text-white">طباعة QR — {data?.name}</button>}</div>}
  </div>;
}
