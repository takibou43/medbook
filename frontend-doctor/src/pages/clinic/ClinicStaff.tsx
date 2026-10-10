import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { FormEvent, useState } from "react";
import { api } from "../../lib/api";
import { clinicPermissions } from "../../lib/clinicAccess";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";

export interface ClinicStaffDoctor {
  id: string; userId: string; firstName: string; lastName: string;
  clinicManagerForId: string | null; clinicPermissions: string[];
}
export interface ClinicStaffAssistant {
  id: string; doctorId: string; clinicId: string | null; firstName: string; lastName: string;
  allDoctors: boolean; allowedDoctorIds: string[]; isActive: boolean; user: { email: string };
}
type Action = (fn: () => Promise<void>) => Promise<void>;

function ScopeFields({ doctors, initialAll = true, initialIds = [] }: {
  doctors: ClinicStaffDoctor[]; initialAll?: boolean; initialIds?: string[];
}) {
  useLanguage();
  const [all, setAll] = useState(initialAll);
  return <fieldset className="space-y-3">
    <legend className="mb-2 font-semibold">{t("الأطباء الذين يساعدهم")}</legend>
    <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" name="allDoctors" checked={all} onChange={e => setAll(e.target.checked)} />{t("جميع أطباء العيادة، بما فيهم من ينضم لاحقًا")}</label>
    {!all && <div className="grid gap-2 sm:grid-cols-2">{doctors.map(d => <label className="flex min-h-[44px] items-center gap-2 rounded-lg border p-2" key={d.id}><input type="checkbox" name="doctorIds" value={d.id} defaultChecked={initialIds.includes(d.id)} />{t("د. ")}{d.firstName} {d.lastName}</label>)}</div>}
    {!all && <p className="text-sm text-slate-500">{t("اختر طبيبًا واحدًا أو أكثر. بقية الأطباء لا يظهرون لهذا المساعد.")}</p>}
  </fieldset>;
}
function scopeFromForm(form: FormData) {
  const allDoctors = form.has("allDoctors");
  const doctorIds = allDoctors ? [] : form.getAll("doctorIds").map(String);
  if (!allDoctors && !doctorIds.length) throw new Error(t("اختر طبيبًا واحدًا على الأقل أو جميع الأطباء."));
  return { allDoctors, doctorIds };
}

export default function ClinicStaff({ clinicId, ownerId, isOwner, permissions, doctors, assistants, busy, run, onInvite }: {
  clinicId: string; ownerId: string | null; isOwner: boolean; permissions: string[];
  doctors: ClinicStaffDoctor[]; assistants: ClinicStaffAssistant[]; busy: boolean; run: Action;
  onInvite: (token: string | null, message: string) => void;
}) {
  useLanguage();
  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const element = e.currentTarget; const form = new FormData(element);
    void run(async () => {
      const body = { email: form.get("email"), ...scopeFromForm(form) };
      const result = (await api.post("/clinics/mine/assistants", body)).data.data;
      onInvite(result.rawToken ?? null, result.alreadyShared ? t("حُفظت صلاحيات المساعد الموجود دون إنشاء حساب جديد.") : t("أُنشئت الدعوة بالصلاحيات المحددة. انسخ الرابط وأرسله للمساعد."));
      element.reset();
    });
  }
  return <>
    {isOwner && doctors.length > 0 && <details className="card p-5"><summary className="cursor-pointer text-lg font-bold">{t("إضافة مساعد وتحديد صلاحياته")}</summary>
      <form onSubmit={invite} className="mt-4 space-y-4"><Input name="email" type="email" label={t("بريد المساعد")} required /><ScopeFields doctors={doctors} /><Button type="submit" loading={busy}>{t("إنشاء رابط دعوة المساعد")}</Button></form>
      <p className="mt-3 text-sm text-slate-500">{t("يمكن إضافة عدة مساعدين. لكل مساعد حساب مستقل ونطاق أطباء يحدده المالك.")}</p>
    </details>}
    <section className="card space-y-4 p-5"><h2 className="text-lg font-bold">{t("مساعدو العيادة (")}{assistants.length})</h2>
      {!assistants.length && <p className="text-slate-500">{t("لا يوجد مساعدون بعد.")}</p>}
      {assistants.map(a => <article key={a.id} className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{a.firstName} {a.lastName}</h3><p dir="ltr" className="text-sm">{a.user.email}</p></div><span>{a.isActive ? t("نشط") : t("الوصول معطّل")}</span></div>
        <p className="text-sm text-slate-600">{a.clinicId && a.allDoctors ? t("يساعد جميع أطباء العيادة") : t("الأطباء المحددون: {0}", { "0": doctors.filter(d => a.clinicId ? a.allowedDoctorIds.includes(d.id) : d.id === a.doctorId).map(d => `د. ${d.firstName} ${d.lastName}`).join("، ") || "لا يوجد طبيب متاح حاليًا" })}</p>
        {isOwner && a.clinicId && <details><summary className="cursor-pointer font-semibold text-primary-700">{t("تعديل الأطباء المسموحين")}</summary><form key={`${a.allDoctors}:${a.allowedDoctorIds.join(",")}`} className="mt-3 space-y-3" onSubmit={e => {
          e.preventDefault(); const form = new FormData(e.currentTarget);
          void run(async () => { await api.patch(`/clinics/mine/assistants/${a.id}/scope`, scopeFromForm(form)); });
        }}><ScopeFields doctors={doctors} initialAll={a.allDoctors} initialIds={a.allowedDoctorIds} /><Button type="submit" loading={busy}>{t("حفظ صلاحيات المساعد")}</Button></form></details>}
        {(isOwner || permissions.includes("MANAGE_ASSISTANT_STATUS")) && <button disabled={busy} className={`min-h-[44px] ${a.isActive ? "text-red-600" : "text-primary-700"}`} onClick={() => void run(async () => { await api.patch(`/clinics/mine/doctors/${doctors.find(d => d.id === a.doctorId)?.id ?? doctors[0]?.id}/assistants/${a.id}`, { isActive: !a.isActive }); })}>{a.isActive ? t("تعطيل الوصول لكل أطبائه") : t("تفعيل الوصول")}</button>}
      </article>)}
    </section>
    {isOwner && <section className="card space-y-4 p-5"><h2 className="text-lg font-bold">{t("المديرون وصلاحياتهم")}</h2><p className="text-sm text-slate-500">{t("المالك وحده يعيّن المديرين ويمنح صلاحياتهم. إضافة الأطباء والمساعدين وتغيير الصلاحيات تبقى للمالك.")}</p>
      {doctors.filter(d => d.userId !== ownerId).map(d => <form key={`${d.id}:${d.clinicManagerForId}:${d.clinicPermissions.join(",")}`} className="space-y-3 rounded-xl border p-4" onSubmit={e => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        void run(async () => { await api.patch(`/clinics/mine/doctors/${d.id}/manager`, { isManager: form.has("isManager"), permissions: form.getAll("permissions") }); });
      }}><h3 className="font-bold">{t("د. ")}{d.firstName} {d.lastName}</h3><label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" name="isManager" defaultChecked={d.clinicManagerForId === clinicId} />{t("تعيينه مديرًا للعيادة")}</label><fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 font-semibold">{t("الصلاحيات الممنوحة")}</legend>{clinicPermissions.map(p => <label key={p.value} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" name="permissions" value={p.value} defaultChecked={d.clinicPermissions.includes(p.value)} />{t(p.label)}</label>)}</fieldset><Button type="submit" loading={busy}>{t("حفظ صلاحيات المدير")}</Button></form>)}
    </section>}
  </>;
}
