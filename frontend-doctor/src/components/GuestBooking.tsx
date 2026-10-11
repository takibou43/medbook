import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../lib/api";
import { algeriaDay } from "../lib/features";
import { Modal } from "./ui/Modal";
import { t } from "../i18n/locale";

/**
 * نافذة «حجز موعد» لمريض دون حساب. يفتحها زر «حجز موعد» في «الإجراءات السريعة» لرأس لوحة الطبيب فقط،
 * ويظهر الزر للطبيب الذي لا مساعد له وحده. الواجهة لا تُعتمد للأمان: POST /doctor/appointments/guest
 * يعيد 403 برسالة عربية إن كان لدى الطبيب مساعد فعلي، فتظهر هنا كما هي.
 */
export function GuestBookingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(algeriaDay());
  const [time, setTime] = useState("");
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [key, setKey] = useState("");
  const qc = useQueryClient();
  const slots = useQuery({ queryKey: ["follow-up-slots", date], enabled: open,
    queryFn: async () => (await api.get<{ data: { slots: string[] } }>("/doctor/follow-up-slots", { params: { date } })).data.data });
  const book = useMutation({ mutationFn: () => api.post("/doctor/appointments/guest", { firstName, lastName, phone, date, startTime: time, idempotencyKey: key }),
    onSuccess: () => { onClose(); qc.invalidateQueries({ queryKey: ["appointments"] }); qc.invalidateQueries({ queryKey: ["queue"] }); qc.invalidateQueries({ queryKey: ["doctor-dashboard"] }); },
    onError: () => { qc.invalidateQueries({ queryKey: ["follow-up-slots", date] }); qc.invalidateQueries({ queryKey: ["doctor-dashboard"] }); },
  });
  // كل فتح جديد يبدأ نموذجًا نظيفًا بمفتاح طلب جديد (idempotencyKey) — كما كان زر الفتح يفعل سابقًا.
  const { reset } = book;
  useEffect(() => {
    if (!open) return;
    setKey(crypto.randomUUID()); setFirst(""); setLast(""); setPhone(""); setTime(""); setDate(algeriaDay()); reset();
  }, [open, reset]);
  return (
    <Modal open={open} onClose={() => { if (!book.isPending) onClose(); }} title={t("حجز موعد")}>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); book.mutate(); }}>
        <label className="block">{t("الاسم")}<input className="input" required minLength={2} maxLength={60} value={firstName} onChange={e => setFirst(e.target.value)} /></label>
        <label className="block">{t("اللقب")}<input className="input" required minLength={2} maxLength={60} value={lastName} onChange={e => setLast(e.target.value)} /></label>
        <label className="block">{t("رقم الهاتف")}<input className="input" type="tel" dir="ltr" required pattern="0[5-7][0-9]{8}" value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <label className="block">{t("التاريخ")}<input className="input" type="date" required min={algeriaDay()} value={date} onChange={e => { setDate(e.target.value); setTime(""); }} /></label>
        <label className="block">{t("الوقت")}<select className="input" required value={time} onChange={e => setTime(e.target.value)}><option value="">{t("اختر الوقت")}</option>{slots.data?.slots.map(s => <option value={s} key={s}>{s}</option>)}</select></label>
        {slots.isError && <p role="alert">{t("تعذّر تحميل الأوقات.")}</p>}
        {book.isError && <p role="alert" className="text-red-700">{apiErrorMessage(book.error)}</p>}
        <button className="btn-primary" disabled={book.isPending || !time || !slots.data?.slots.includes(time)}>{t("تأكيد الحجز")}</button>
      </form>
    </Modal>
  );
}
