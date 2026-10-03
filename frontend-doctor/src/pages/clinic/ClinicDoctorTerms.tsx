import { FormEvent, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { clinicSharePercentOf, formatDzd, formatPercent, parseTermsForm, termsExampleAr } from "../../lib/doctorUi";

/** شروط طبيب داخل العيادة كما يراها مدير العيادة وحده. نسبة العيادة للقراءة فقط: تُحسب من نسبة الطبيب. */
export interface DoctorTerms {
  appointmentPriceDzd: number | null;
  priceSource: "CLINIC" | "DOCTOR_DEFAULT";
  doctorSharePercent: number | null;
  clinicSharePercent: number | null;
}

export default function ClinicDoctorTerms({ doctorId, terms, onSaved }: { doctorId: string; terms: DoctorTerms; onSaved: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(terms.appointmentPriceDzd ?? ""));
  const [share, setShare] = useState(terms.doctorSharePercent == null ? "" : String(terms.doctorSharePercent));
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [done, setDone] = useState("");
  const parsed = parseTermsForm(price, share);
  const livePct = /^\d{1,3}$/.test(share.trim()) && Number(share) <= 100 ? clinicSharePercentOf(Number(share)) : null;
  const example = parsed.ok ? termsExampleAr(parsed.value.appointmentPriceDzd, parsed.value.doctorSharePercent) : termsExampleAr(terms.appointmentPriceDzd, terms.doctorSharePercent);

  async function save(e: FormEvent) {
    e.preventDefault(); setError(""); setDone("");
    if (!parsed.ok) { setError(parsed.error); return; }
    setSaving(true);
    try {
      await api.patch(`/clinics/mine/doctors/${doctorId}/terms`, parsed.value);
      await onSaved(); setEditing(false); setDone("حُفظت الشروط. تسري على المواعيد الجديدة فقط ولا تغيّر المواعيد السابقة.");
    } catch (err) { setError(apiErrorMessage(err, "تعذر حفظ الشروط.")); } finally { setSaving(false); }
  }

  return <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3" dir="rtl" aria-label="سعر الموعد ونسبة الطبيب">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">السعر والنسب</h3>
      {!editing && <button type="button" className="text-primary-700" onClick={() => { setEditing(true); setDone(""); }}>تعديل</button>}</div>
    {!editing && <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-lg bg-white p-2"><dt className="text-xs text-slate-500">سعر الموعد</dt><dd className="font-bold tabular-nums">{formatDzd(terms.appointmentPriceDzd)}</dd></div>
      <div className="rounded-lg bg-white p-2"><dt className="text-xs text-slate-500">نسبة الطبيب</dt><dd className="font-bold tabular-nums">{formatPercent(terms.doctorSharePercent)}</dd></div>
      <div className="rounded-lg bg-white p-2"><dt className="text-xs text-slate-500">نسبة العيادة</dt><dd className="font-bold tabular-nums">{formatPercent(terms.clinicSharePercent)}</dd></div>
    </dl>}
    {!editing && terms.doctorSharePercent == null && <p className="mt-2 text-sm text-amber-700">لم تُحدَّد نسبة الطبيب بعد، فلا تُحسب له مستحقات حتى تحددها.</p>}
    {!editing && terms.priceSource === "DOCTOR_DEFAULT" && terms.appointmentPriceDzd != null && <p className="mt-1 text-xs text-slate-500">السعر الحالي هو سعر الطبيب السابق ولم تحدد سعرًا للعيادة بعد.</p>}
    {editing && <form onSubmit={save} className="mt-2 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="سعر الموعد (دج)" name="appointmentPriceDzd" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} required />
        <Input label="نسبة الطبيب (%)" name="doctorSharePercent" inputMode="numeric" value={share} onChange={e => setShare(e.target.value)} required />
      </div>
      <p className="text-sm">نسبة العيادة (تلقائية): <strong className="tabular-nums">{formatPercent(livePct)}</strong></p>
      <div className="flex gap-3"><Button type="submit" loading={saving}>حفظ</Button><button type="button" onClick={() => { setEditing(false); setError(""); }}>إلغاء</button></div>
    </form>}
    {example && <p className="mt-2 text-sm text-slate-700">{example}</p>}
    <p className="mt-1 text-xs text-slate-500">هذه النسبة خاصة بإيراد المواعيد، ومنفصلة عن اشتراك مادبوك. لا يراها الأطباء الآخرون.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {done && <p role="status" className="mt-2 text-sm text-primary-800">{done}</p>}
  </div>;
}
