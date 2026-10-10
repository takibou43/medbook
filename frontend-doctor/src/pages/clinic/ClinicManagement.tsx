import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { ClinicProfile, ClinicProfileFields, profileFromForm } from "./ClinicForms";
import ClinicTransferRequests from "./ClinicTransferRequests";
import ClinicDoctorTerms, { DoctorTerms } from "./ClinicDoctorTerms";
import ClinicFinanceReport from "./ClinicFinanceReport";
import { doctorsCountAr, formatDayAr, formatDzd, parseTermsForm } from "../../lib/doctorUi";
import ClinicStaff, { ClinicStaffAssistant, ClinicStaffDoctor } from "./ClinicStaff";
interface ManagedClinic extends ClinicProfile {
  ownerId: string | null; isOwner: boolean; permissions: string[]; assistants: ClinicStaffAssistant[];
  id: string; referralDiscountUntil: string | null; pendingReferralDays: number; verificationStatus: string; subscriptionStatus: string; subscriptionExpiresAt: string | null;
  billing: { billedDoctorCount: number; discountedDoctorCount: number; doctorCount: number; monthlyTotal: number; monthlyPerDoctor: number; paidDoctorCount: number };
  doctors: (ClinicStaffDoctor & { id: string; firstName: string; lastName: string; specialty: { nameAr: string; nameFr?: string | null }; verificationStatus: string; terms: DoctorTerms | null;
    user: { email: string; isActive: boolean }; assistants: ClinicStaffAssistant[] })[];
  invites: { id: string; email: string; expiresAt: string; termsPriceDzd?: number | null; termsDoctorSharePercent?: number | null }[];
}
const stateLabels: Record<string, string> = { ACTIVE: "نشط", UNPAID: "غير مفعّل", EXPIRED: "منتهي", PENDING: "قيد المراجعة", VERIFIED: "موثّق", REJECTED: "مرفوض" };
export default function ClinicManagement() {
  useLanguage();
  const { user, refreshMe } = useAuth(); const qc = useQueryClient();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [link, setLink] = useState(""); const [editing, setEditing] = useState(false);
  const query = useQuery({ queryKey: ["my-clinic", user?.id], queryFn: async () => (await api.get<{ data: ManagedClinic }>("/clinics/mine")).data.data, retry: false });
  const clinic = query.data;
  const missing = query.isError && (query.error as { response?: { status?: number } }).response?.status === 404;
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); await Promise.all([qc.invalidateQueries({ queryKey: ["my-clinic"] }), qc.invalidateQueries({ queryKey: ["my-clinic-transfers"] })]); }
    catch (err) { setError(apiErrorMessage(err, t("تعذر تنفيذ العملية."))); } finally { setBusy(false); }
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = profileFromForm(new FormData(e.currentTarget));
    void run(async () => {
      if (clinic) await api.patch("/clinics/mine", data); else await api.post("/clinics/mine", data);
      await refreshMe(); setEditing(false); setMessage(t("حُفظت بيانات العيادة. تغييرات الاسم والعنوان والموقع تحتاج مراجعة الإدارة."));
    });
  }
  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); const element = e.currentTarget;
    const body: Record<string, unknown> = { email: form.get("email") };
    const price = String(form.get("appointmentPriceDzd") ?? "").trim(); const share = String(form.get("doctorSharePercent") ?? "").trim();
    if (price || share) {
      const terms = parseTermsForm(price, share);
      if (!terms.ok) { setError(terms.error + t(" اتركهما فارغين إن أردت ضبطهما لاحقًا.")); setMessage(""); return; }
      Object.assign(body, terms.value);
    }
    void run(async () => {
      const result = (await api.post("/clinics/mine/invites", body)).data.data;
      setLink(window.location.origin + "/clinic/doctor/accept/" + result.rawToken);
      element.reset(); setMessage(t("انسخ رابط الدعوة وأرسله لصاحب البريد المحدد. الرابط صالح لمدة 7 أيام."));
    });
  }
  if (query.isPending) return <p>{t("جارٍ تحميل العيادة…")}</p>;
  return <section className="space-y-5">
    <header><h1 className="text-2xl font-extrabold">{clinic?.nameAr || (missing && user?.doctor?.clinic?.nameAr) || t("إنشاء عيادتك")}</h1><p className="mt-2 text-slate-600">{t("كل طبيب له جدول وحجوزات مستقلة، والعيادة تدفع اشتراكًا واحدًا.")}</p></header>
    {user?.role === "DOCTOR" && !clinic && !user.doctor?.clinic && <details className="card p-5"><summary className="cursor-pointer font-bold">{t("طلب الانضمام لعيادة دون دعوة")}</summary><div className="mt-4"><ClinicTransferRequests /></div></details>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{t(error ?? "")}</p>}
    {message && <p role="status" className="rounded-xl bg-primary-50 p-3 text-primary-800">{t(message ?? "")}</p>}
    {query.isError && !missing && <p role="alert">{apiErrorMessage(query.error, t("تعذر تحميل العيادة."))} <button onClick={() => void query.refetch()}>{t("إعادة المحاولة")}</button></p>}
    {missing && user?.doctor?.clinic && <p role="status" className="card p-5 text-slate-700">{t("أنت طبيب ضمن «")}{user.doctor.clinic.nameAr}{t("». إدارة العيادة (الأطباء والأسعار والمساعدون) لمديرها وحده، وإنشاء عيادة أخرى يحتاج معالجة الارتباط الحالي من الإدارة.")}</p>}
    {((missing && !user?.doctor?.clinic) || editing) && <form onSubmit={save} className="card space-y-4 p-5"><ClinicProfileFields initial={clinic} />
      {missing && user?.role === "DOCTOR" && <p className="text-sm">{t("إنشاء العيادة يرسل طلب انتقال ملفك الطبي إلى الإدارة، ويستمر اشتراكك الحالي إلى حين الموافقة.")}</p>}
      <Button type="submit" loading={busy}>{clinic ? t("حفظ البيانات") : t("إنشاء العيادة")}</Button>
      {editing && <button type="button" className="ms-3" onClick={() => setEditing(false)}>{t("إلغاء")}</button>}
    </form>}
    {clinic && <>
      <details className="card space-y-3 p-5">
        <summary className="cursor-pointer text-lg font-bold">{t("بيانات العيادة والاشتراك — ")}{doctorsCountAr(clinic.billing.doctorCount)}</summary>
        <div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-bold">{t("اشتراك العيادة")}</h2>{clinic.permissions.includes("EDIT_PROFILE") && <Button variant="outline" onClick={() => setEditing(!editing)}>{t("تعديل بيانات العيادة")}</Button>}</div>
        <p>{t("المراجعة: ")}{t(stateLabels[clinic.verificationStatus])}{t(" · الاشتراك: ")}{clinic.subscriptionExpiresAt && new Date(clinic.subscriptionExpiresAt) <= new Date() ? t("منتهي") : t(stateLabels[clinic.subscriptionStatus])}</p>
        <p className="text-sm text-slate-600">{t("التكلفة الشهرية التقديرية حسب الأطباء المحتسبين حاليًا")}</p><p className="text-2xl font-bold text-primary-700">{formatDzd(clinic.billing.monthlyTotal)}{t(" / شهر")}</p>
        <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-slate-500">{t("الأطباء الحاليون")}</dt><dd>{doctorsCountAr(clinic.billing.doctorCount)}</dd></div><div><dt className="text-slate-500">{t("السعة المدفوعة")}</dt><dd>{doctorsCountAr(clinic.billing.paidDoctorCount)}</dd></div><div><dt className="text-slate-500">{t("الأطباء المحتسبون في التكلفة")}</dt><dd>{doctorsCountAr(clinic.billing.billedDoctorCount)} × {formatDzd(clinic.billing.monthlyPerDoctor)}</dd></div><div><dt className="text-slate-500">{t("تاريخ الانتهاء")}</dt><dd>{clinic.subscriptionExpiresAt ? formatDayAr(clinic.subscriptionExpiresAt.slice(0, 10)) : t("غير محدد")}</dd></div></dl>
        <p className="text-sm text-slate-600">{t("حسابات المساعدين مشمولة. صاحب العيادة يُحتسب مرة واحدة إذا كان طبيبًا. تفعيل الاشتراك أو زيادة السعة يتم عبر إدارة MedBook.")}</p>
        {clinic.billing.discountedDoctorCount > 0 && <p className="text-emerald-700">{t("مكافأة الإحالة: تُحسب تكلفة ")}{doctorsCountAr(clinic.billing.billedDoctorCount)}{t(" بدل ")}{doctorsCountAr(clinic.billing.doctorCount)}{t(" حتى ")}{clinic.referralDiscountUntil?.slice(0, 10)}{t(". جميع الأطباء مشمولون بالخدمة.")}</p>}
        {clinic.pendingReferralDays > 0 && <p>{t("خصم محفوظ لمدة ")}{clinic.pendingReferralDays}{t(" يومًا، يبدأ عند تفعيل الاشتراك.")}</p>}
      </details>
      {clinic.isOwner && <div className="card p-5"><h2 className="mb-3 text-lg font-bold">{t("دعوة طبيب إلى العيادة")}</h2>
        <p className="mb-4 text-sm text-slate-600">{t("أدخل بريد الطبيب، ثم أرسل له الرابط. ينضم عند قبول الدعوة دون انتظار موافقة الإدارة.")}</p>
        <form onSubmit={e => invite(e)} className="space-y-4"><Input name="email" type="email" label={t("بريد الطبيب")} required />
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">{t("تحديد سعر الكشف ونسبة الطبيب (اختياري)")}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Input name="appointmentPriceDzd" inputMode="numeric" label={t("سعر الكشف (دج)")} /><Input name="doctorSharePercent" inputMode="numeric" label={t("نصيب الطبيب (%)")} /></div><p className="mt-2 text-sm text-slate-500">{t("يمكن تحديدهما بعد انضمام الطبيب. نصيب العيادة يُحسب تلقائيًا.")}</p></details>
          <Button type="submit" loading={busy} className="min-h-[48px]">{t("إنشاء رابط الدعوة")}</Button></form>
        {clinic.invites.map(i => <div key={i.id} className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3"><span dir="ltr">{i.email}</span><span>{new Date(i.expiresAt) <= new Date() ? t("منتهية") : t("بانتظار القبول")}</span><button disabled={busy} className="text-red-600" onClick={() => void run(async () => { await api.delete(`/clinics/mine/invites/${i.id}`); })}>{t("إلغاء الدعوة")}</button></div>)}
      </div>}
      <ClinicStaff clinicId={clinic.id} ownerId={clinic.ownerId} isOwner={clinic.isOwner} permissions={clinic.permissions} doctors={clinic.doctors} assistants={clinic.assistants} busy={busy} run={run} onInvite={(token, message) => { setLink(token ? `${window.location.origin}/assistant/accept/${token}` : ""); setMessage(message); }} />
      {link && <div className="card space-y-2 p-5"><label htmlFor="invite-link" className="font-bold">{t("رابط الدعوة الجديدة")}</label><input id="invite-link" value={link} readOnly dir="ltr" className="w-full rounded-lg border p-3" onFocus={e => e.target.select()} /><p className="text-sm text-slate-500">{t("يظهر هذا الرابط بعد إنشائه فقط؛ احفظه قبل مغادرة الصفحة.")}</p><button onClick={() => setLink("")}>{t("إخفاء الرابط")}</button></div>}
      {clinic.permissions.includes("VIEW_FINANCE") && clinic.doctors.length > 0 && <details className="card p-5"><summary className="cursor-pointer text-lg font-bold">{t("تقرير إيرادات العيادة")}</summary><div className="mt-4"><ClinicFinanceReport /></div></details>}
      <div className="grid gap-4 md:grid-cols-2">{clinic.doctors.map(d => <article key={d.id} className="card p-5"><h2 className="font-bold">{t("د. ")}{d.firstName} {d.lastName}</h2><p>{catalogName(d.specialty)} · {t(stateLabels[d.verificationStatus])}</p><p className="text-sm" dir="ltr">{d.user.email}</p>
        {clinic.permissions.includes("MANAGE_TERMS") && d.terms && <ClinicDoctorTerms doctorId={d.id} terms={d.terms} onSaved={async () => { await qc.invalidateQueries({ queryKey: ["my-clinic"] }); await qc.invalidateQueries({ queryKey: ["clinic-finance"] }); }} />}
        <h3 className="mt-4 font-semibold">{t("المساعدون المتاحون لهذا الطبيب (")}{d.assistants.length})</h3>
        {d.assistants.map(a => <p key={a.id} className="mt-2 text-sm">{a.firstName} {a.lastName} · {a.isActive ? t("نشط") : t("معطّل")}</p>)}
      </article>)}</div>
    </>}
  </section>;
}
