import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Input";
import { ClinicProfile, ClinicProfileFields, profileFromForm } from "./ClinicForms";
import ClinicTransferRequests from "./ClinicTransferRequests";
interface ManagedClinic extends ClinicProfile {
  id: string; verificationStatus: string; subscriptionStatus: string; subscriptionExpiresAt: string | null;
  billing: { doctorCount: number; monthlyTotal: number; monthlyPerDoctor: number; paidDoctorCount: number };
  doctors: { id: string; firstName: string; lastName: string; specialty: { nameAr: string }; verificationStatus: string;
    user: { email: string; isActive: boolean }; assistants: { id: string; firstName: string; lastName: string; isActive: boolean; user: { email: string } }[] }[];
  invites: { id: string; email: string; expiresAt: string }[];
}
const stateLabels: Record<string, string> = { ACTIVE: "نشط", UNPAID: "غير مفعّل", EXPIRED: "منتهي", PENDING: "قيد المراجعة", VERIFIED: "موثّق", REJECTED: "مرفوض" };
export default function ClinicManagement() {
  const { user, refreshMe } = useAuth(); const qc = useQueryClient();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [link, setLink] = useState(""); const [editing, setEditing] = useState(false);
  const query = useQuery({ queryKey: ["my-clinic", user?.id], queryFn: async () => (await api.get<{ data: ManagedClinic }>("/clinics/mine")).data.data, retry: false });
  const clinic = query.data;
  const missing = query.isError && (query.error as { response?: { status?: number } }).response?.status === 404;
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); await Promise.all([qc.invalidateQueries({ queryKey: ["my-clinic"] }), qc.invalidateQueries({ queryKey: ["my-clinic-transfers"] })]); }
    catch (err) { setError(apiErrorMessage(err, "تعذر تنفيذ العملية.")); } finally { setBusy(false); }
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = profileFromForm(new FormData(e.currentTarget));
    void run(async () => {
      if (clinic) await api.patch("/clinics/mine", data); else await api.post("/clinics/mine", data);
      await refreshMe(); setEditing(false); setMessage("حُفظت بيانات العيادة. تغييرات الاسم والعنوان والموقع تحتاج مراجعة الإدارة.");
    });
  }
  function invite(e: FormEvent<HTMLFormElement>, assistant = false) {
    e.preventDefault(); const form = new FormData(e.currentTarget); const element = e.currentTarget;
    void run(async () => {
      const path = assistant ? `/clinics/mine/doctors/${form.get("doctorId")}/assistants` : "/clinics/mine/invites";
      const result = (await api.post(path, { email: form.get("email") })).data.data;
      setLink(`${window.location.origin}/${assistant ? "assistant" : "clinic/doctor"}/accept/${result.rawToken}`);
      element.reset(); setMessage("انسخ رابط الدعوة وأرسله لصاحب البريد المحدد. الرابط صالح لمدة 7 أيام.");
    });
  }
  if (query.isPending) return <p>جارٍ تحميل العيادة…</p>;
  return <section className="space-y-5" dir="rtl">
    <header><h1 className="text-2xl font-extrabold">{clinic?.nameAr || "إنشاء عيادتك"}</h1><p className="mt-2 text-slate-600">كل طبيب له جدول وحجوزات مستقلة، والعيادة تدفع اشتراكًا واحدًا.</p></header>
    {user?.role === "DOCTOR" && <ClinicTransferRequests />}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-primary-50 p-3 text-primary-800">{message}</p>}
    {query.isError && !missing && <p role="alert">{apiErrorMessage(query.error, "تعذر تحميل العيادة.")} <button onClick={() => void query.refetch()}>إعادة المحاولة</button></p>}
    {missing && user?.doctor?.clinic && <p>أنت مرتبط بعيادة. إنشاء عيادة أخرى يحتاج معالجة الارتباط الحالي من الإدارة.</p>}
    {((missing && !user?.doctor?.clinic) || editing) && <form onSubmit={save} className="card space-y-4 p-5"><ClinicProfileFields initial={clinic} />
      {missing && user?.role === "DOCTOR" && <p className="text-sm">إنشاء العيادة يرسل طلب انتقال ملفك الطبي إلى الإدارة، ويستمر اشتراكك الحالي إلى حين الموافقة.</p>}
      <Button type="submit" loading={busy}>{clinic ? "حفظ البيانات" : "إنشاء العيادة"}</Button>
      {editing && <button type="button" className="mr-3" onClick={() => setEditing(false)}>إلغاء</button>}
    </form>}
    {clinic && <>
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-bold">اشتراك العيادة</h2><Button variant="outline" onClick={() => setEditing(!editing)}>تعديل بيانات العيادة</Button></div>
        <p>المراجعة: {stateLabels[clinic.verificationStatus]} · الاشتراك: {clinic.subscriptionExpiresAt && new Date(clinic.subscriptionExpiresAt) <= new Date() ? "منتهي" : stateLabels[clinic.subscriptionStatus]}</p>
        <p className="text-2xl font-bold text-primary-700">{clinic.billing.monthlyTotal.toLocaleString("ar-DZ")} دج / شهر</p>
        <p>{clinic.billing.doctorCount} أطباء × {clinic.billing.monthlyPerDoctor.toLocaleString("ar-DZ")} دج. السعة المدفوعة: {clinic.billing.paidDoctorCount} أطباء.</p>
        <p className="text-sm text-slate-600">حسابات المساعدين مشمولة. صاحب العيادة يُحتسب مرة واحدة إذا كان طبيبًا. تفعيل الاشتراك أو زيادة السعة يتم عبر إدارة مادبوك.</p>
        {clinic.subscriptionExpiresAt && <p>ينتهي في: {new Date(clinic.subscriptionExpiresAt).toLocaleDateString("ar-DZ")}</p>}
      </div>
      <div className="card p-5"><h2 className="mb-3 text-lg font-bold">دعوة طبيب إلى العيادة</h2>
        <form onSubmit={e => invite(e)} className="flex flex-wrap items-end gap-3"><Input name="email" type="email" label="بريد الطبيب" required /><Button type="submit" loading={busy}>إنشاء رابط دعوة</Button></form>
        <p className="mt-2 text-sm text-slate-500">الطبيب الجديد ينشئ حسابًا عبر الدعوة. الطبيب المسجّل يرسل طلب انتقال لموافقة الإدارة.</p>
        {clinic.invites.map(i => <div key={i.id} className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3"><span dir="ltr">{i.email}</span><span>{new Date(i.expiresAt) <= new Date() ? "منتهية" : "بانتظار القبول"}</span><button disabled={busy} className="text-red-600" onClick={() => void run(async () => { await api.delete(`/clinics/mine/invites/${i.id}`); })}>إلغاء الدعوة</button></div>)}
      </div>
      {clinic.doctors.length > 0 && <div className="card p-5"><h2 className="mb-3 text-lg font-bold">إضافة مساعد</h2>
        <form onSubmit={e => invite(e, true)} className="grid items-end gap-3 sm:grid-cols-3">
          <Select label="الطبيب الذي يعمل معه المساعد" name="doctorId" required><option value="">اختر الطبيب</option>{clinic.doctors.map(d => <option key={d.id} value={d.id}>د. {d.firstName} {d.lastName}</option>)}</Select>
          <Input name="email" type="email" label="بريد المساعد" required /><Button type="submit" loading={busy}>دعوة مساعد</Button>
        </form><p className="mt-2 text-sm text-slate-500">لكل مساعد حساب مستقل، ويصل إلى مواعيد الطبيب المحدد فقط.</p>
      </div>}
      {link && <div className="card space-y-2 p-5"><label htmlFor="invite-link" className="font-bold">رابط الدعوة الجديدة</label><input id="invite-link" value={link} readOnly dir="ltr" className="w-full rounded-lg border p-3" onFocus={e => e.target.select()} /><p className="text-sm text-slate-500">يظهر هذا الرابط بعد إنشائه فقط؛ احفظه قبل مغادرة الصفحة.</p><button onClick={() => setLink("")}>إخفاء الرابط</button></div>}
      <div className="grid gap-4 md:grid-cols-2">{clinic.doctors.map(d => <article key={d.id} className="card p-5"><h2 className="font-bold">د. {d.firstName} {d.lastName}</h2><p>{d.specialty.nameAr} · {stateLabels[d.verificationStatus]}</p><p className="text-sm" dir="ltr">{d.user.email}</p><h3 className="mt-4 font-semibold">المساعدون ({d.assistants.length})</h3>
        {d.assistants.map(a => <div key={a.id} className="mt-3 flex justify-between gap-3 border-t pt-3"><div>{a.firstName} {a.lastName}<p className="text-xs" dir="ltr">{a.user.email}</p></div><button disabled={busy} className={a.isActive ? "text-red-600" : "text-primary-700"} onClick={() => void run(async () => { await api.patch(`/clinics/mine/doctors/${d.id}/assistants/${a.id}`, { isActive: !a.isActive }); })}>{a.isActive ? "تعطيل الوصول" : "تفعيل الوصول"}</button></div>)}
      </article>)}</div>
    </>}
  </section>;
}
