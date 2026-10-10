import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Archive, Pencil, Plus, Users } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { Input } from "../../components/ui/Input";
import type { FamilyMember, FamilyRelationship } from "../../types";
import { RELATIONSHIP_LABELS, RELATIONSHIP_OPTIONS, memberFullName, validateMemberForm } from "../../lib/family";

/**
 * «أفراد العائلة» — صاحب الحساب يضيف ويعدّل ويؤرشف من يحجز لهم. البيانات من الخادم وفي الذاكرة فقط
 * (React Query) — لا تخزين محلي في المتصفح ولا تخزين دون اتصال. الأرشفة لا تحذف أي موعد سابق.
 */
type FormState = { firstName: string; lastName: string; relationship: FamilyRelationship | ""; birthDate: string; gender: "" | "MALE" | "FEMALE" };
const EMPTY: FormState = { firstName: "", lastName: "", relationship: "", birthDate: "", gender: "" };

function toForm(m: FamilyMember): FormState {
  return {
    firstName: m.firstName,
    lastName: m.lastName,
    relationship: m.relationship,
    birthDate: m.birthDate ? m.birthDate.slice(0, 10) : "",
    gender: (m.gender as FormState["gender"]) ?? "",
  };
}

function MemberForm({ initial, submitting, onSubmit, onCancel }: { initial: FormState; submitting: boolean; onSubmit: (v: FormState) => void; onCancel: () => void }) {
  useLanguage();
  const [v, setV] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      noValidate
      className="glass space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const errs = validateMemberForm({ ...v, relationship: v.relationship || "" });
        setErrors(errs);
        if (Object.keys(errs).length === 0) onSubmit(v);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label={t("الاسم")} value={v.firstName} maxLength={60} error={errors.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} />
        <Input label={t("اللقب")} value={v.lastName} maxLength={60} error={errors.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="fm-rel">{t("صلة القرابة")}</label>
        <select id="fm-rel" className="input" value={v.relationship} onChange={(e) => setV({ ...v, relationship: e.target.value as FamilyRelationship })}>
          <option value="">{t("اختر")}</option>
          {RELATIONSHIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{t(o.label)}</option>
          ))}
        </select>
        {errors.relationship && <p role="alert" className="mt-1 text-xs text-red-600">{errors.relationship}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label={t("تاريخ الميلاد (اختياري)")} type="date" dir="ltr" value={v.birthDate} error={errors.birthDate} onChange={(e) => setV({ ...v, birthDate: e.target.value })} />
        <div>
          <label className="label" htmlFor="fm-gender">{t("الجنس (اختياري)")}</label>
          <select id="fm-gender" className="input" value={v.gender} onChange={(e) => setV({ ...v, gender: e.target.value as FormState["gender"] })}>
            <option value="">—</option>
            <option value="MALE">{t("ذكر")}</option>
            <option value="FEMALE">{t("أنثى")}</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className="btn-primary min-h-[44px] flex-1 disabled:opacity-50">
          {submitting ? t("جارٍ الحفظ...") : t("حفظ")}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600">{t("إلغاء ")}</button>
      </div>
    </form>
  );
}

export default function FamilyMembers() {
  useLanguage();
  const { user, loading } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["family-members-all"],
    queryFn: async () => (await api.get<{ data: FamilyMember[] }>("/patient/family-members", { params: { includeArchived: "true" } })).data.data,
    enabled: Boolean(user),
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["family-members-all"] });
    qc.invalidateQueries({ queryKey: ["family-members"] });
  };
  const payload = (v: FormState) => ({
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    relationship: v.relationship,
    birthDate: v.birthDate || null,
    gender: v.gender || null,
  });

  const create = useMutation({
    mutationFn: async (v: FormState) => (await api.post("/patient/family-members", payload(v))).data.data,
    onSuccess: () => { showToast(t("تمت إضافة فرد العائلة."), "success"); setAdding(false); invalidate(); },
    onError: (e) => showToast(apiErrorMessage(e, t("تعذّرت الإضافة.")), "error"),
  });
  const update = useMutation({
    mutationFn: async ({ id, v }: { id: string; v: FormState }) => (await api.patch(`/patient/family-members/${id}`, payload(v))).data.data,
    onSuccess: () => { showToast(t("تم حفظ التعديلات."), "success"); setEditingId(null); invalidate(); },
    onError: (e) => showToast(apiErrorMessage(e, t("تعذّر الحفظ.")), "error"),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/patient/family-members/${id}`)).data.data,
    onSuccess: () => { showToast(t("تمت الأرشفة. تبقى مواعيده السابقة محفوظة."), "success"); invalidate(); },
    onError: (e) => showToast(apiErrorMessage(e, t("تعذّرت الأرشفة.")), "error"),
  });

  if (loading) return <Spinner label={t("جارٍ التحميل...")} />;
  if (!user) return <Navigate to="/account/login?redirect=%2Faccount%2Ffamily" replace />;

  const active = (data ?? []).filter((m) => !m.archivedAt);
  const archived = (data ?? []).filter((m) => m.archivedAt);

  return (
    <div className="container-app py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <Link to="/account" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />{t(" العودة إلى حسابي ")}</Link>
        <div className="glass p-5">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
            <Users className="h-5 w-5" aria-hidden="true" />{t(" أفراد العائلة ")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("احجز لأفراد عائلتك من حسابك نفسه. هاتفك هو رقم التواصل للجميع.")}</p>
        </div>

        {isLoading ? (
          <Spinner label={t("جارٍ تحميل أفراد العائلة...")} />
        ) : isError ? (
          <div className="glass p-4 text-sm text-red-600" role="alert">
            {apiErrorMessage(error, t("تعذّر تحميل أفراد العائلة."))}{" "}
            <button type="button" className="font-semibold underline" onClick={() => refetch()}>{t("إعادة المحاولة")}</button>
          </div>
        ) : (
          <>
            {active.length === 0 && !adding && (
              <p className="glass p-4 text-sm text-slate-500">{t("لم تُضف أي فرد بعد. أضف أبناءك أو والديك لتحجز لهم بسهولة.")}</p>
            )}
            <ul className="space-y-3">
              {active.map((m) =>
                editingId === m.id ? (
                  <li key={m.id}>
                    <MemberForm initial={toForm(m)} submitting={update.isPending} onSubmit={(v) => update.mutate({ id: m.id, v })} onCancel={() => setEditingId(null)} />
                  </li>
                ) : (
                  <li key={m.id} className="glass flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{memberFullName(m)}</p>
                      <p className="text-xs text-slate-500">{t(RELATIONSHIP_LABELS[m.relationship] ?? "")}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label={t("تعديل")} onClick={() => setEditingId(m.id)} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("أرشفة")}
                        disabled={archive.isPending}
                        onClick={() => {
                          if (window.confirm(t("أرشفة {0}؟ لن يظهر في اختيارات الحجز، وتبقى مواعيده السابقة محفوظة.", { "0": memberFullName(m) }))) archive.mutate(m.id);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Archive className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                )
              )}
            </ul>

            {adding ? (
              <MemberForm initial={EMPTY} submitting={create.isPending} onSubmit={(v) => create.mutate(v)} onCancel={() => setAdding(false)} />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="btn-primary flex min-h-[48px] w-full items-center justify-center gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />{t(" إضافة فرد ")}</button>
            )}

            {archived.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-bold text-slate-500">{t("مؤرشفون (تبقى مواعيدهم في سجلك)")}</h2>
                <ul className="space-y-2">
                  {archived.map((m) => (
                    <li key={m.id} className="rounded-xl border border-slate-200 bg-white/60 p-3 text-sm text-slate-500">
                      {memberFullName(m)} — {t(RELATIONSHIP_LABELS[m.relationship] ?? "")}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
