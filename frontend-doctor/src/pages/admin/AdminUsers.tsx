import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useAdminConfirm } from "../../components/admin/AdminConfirm";
import { useAuth } from "../../context/AuthContext";
import { AdminResults, AdminActions } from "../../components/admin/AdminUI";
import { useAdminListParams } from "../../hooks/useAdminListParams";
import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";
import { Pagination } from "../../components/ui/Pagination";
import { Role } from "../../types";
import { BlockPatientDialog, BlockTarget } from "../../components/BlockPatientDialog";

const ROLE_LABELS: Record<Role, string> = { PATIENT: "مريض", DOCTOR: "طبيب", ADMIN: "إدارة", ASSISTANT: "مساعد", CLINIC_OWNER: "صاحب عيادة" };

export default function AdminUsers() {
  useLanguage();
  const {user:me}=useAuth(); const confirmation=useAdminConfirm();
  const { params, q, setQ, search, page, setPage, update, clear } = useAdminListParams();
  const id = params.get("id");
  const role = params.get("role") && params.get("role")! in ROLE_LABELS ? params.get("role") as Role : "";
  const setRole = (value: string) => update("role", value);
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [blockTarget, setBlockTarget] = useState<{ t: BlockTarget; mode: "block" | "unblock" } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-users", search, role, page, id],
    queryFn: async ({ signal }) => (await api.get("/admin/users", { signal, params: { id: id || undefined, q: search || undefined, role: role || undefined, page } })).data.data,
  });

  function toggleActive(u:any){confirmation.ask({title:u.isActive?t("تعطيل الحساب"):t("تفعيل الحساب"),record:u.email,reasonRequired:true,impact:u.isActive?t("يمنع الدخول إلى الحساب؛ تبقى الملفات والمواعيد والاشتراكات محفوظة."):t("يعيد إتاحة الدخول دون تغيير حالة حظر الحجوزات أو توثيق الطبيب أو الاشتراك."),action:async reason=>{await api.patch('/admin/users/'+u.id+'/'+(u.isActive?'deactivate':'activate'),{reason});showToast(u.isActive?t("تم تعطيل الحساب."):t("تم تفعيل الحساب."),'success');await qc.invalidateQueries({queryKey:['admin-users']});}});}
  function remove(u:any){confirmation.ask({title:t("حذف الحساب"),record:u.email,reasonRequired:true,impact:t("الحذف نهائي ولا توجد استعادة. قد يمنعه الخادم عند وجود عيادة أو سجلات مرتبطة؛ يشمل الملفات المرتبطة وفق القيود الحالية."),action:async reason=>{await api.delete('/admin/users/'+u.id,{data:{reason}});showToast(t("تم الحذف."),'success');await qc.invalidateQueries({queryKey:['admin-users']});}});}

  const actions = (u: any) => (<AdminActions label={t("المستخدم ") + u.email}>
                        <Button variant="outline" disabled={u.id===me?.id && u.isActive} onClick={() => toggleActive(u)}>
                          {u.isActive ? t("تعطيل") : t("تفعيل")}
                        </Button>
                        {u.patient && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              setBlockTarget({
                                t: { patientId: u.patient.id, name: `${u.patient.firstName} ${u.patient.lastName}`.trim(), email: u.email },
                                mode: u.patient.blocks?.length > 0 ? "unblock" : "block",
                              })
                            }
                          >
                            {u.patient.blocks?.length > 0 ? t("رفع الحظر") : t("حظر المريض")}
                          </Button>
                        )}
                        <Button variant="danger" disabled={u.id===me?.id} onClick={() => remove(u)}>{t("حذف ")}</Button>
                      </AdminActions>);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">{t("إدارة المستخدمين")}</h1>
      {id && <p className="text-sm text-primary-700" role="status">{t("عرض السجل المحدد من الرابط")}</p>}

      <div className="flex flex-wrap gap-3">
        <Input label={t("بحث عن مستخدم")} placeholder={t("بحث بالبريد أو الهاتف...")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select aria-label={t("دور المستخدم")} className="input max-w-[160px]" value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
          <option value="">{t("كل الأدوار")}</option>
          <option value="PATIENT">{t("مريض")}</option>
          <option value="DOCTOR">{t("طبيب")}</option>
          <option value="ASSISTANT">{t("مساعد")}</option>
          <option value="ADMIN">{t("إدارة")}</option><option value="CLINIC_OWNER">{t("صاحب عيادة")}</option>
        </select>
      </div>

      <AdminResults total={data?.total} filtered={!!(q || id || role)} onClear={clear} />

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} onRetry={() => void refetch()} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-3 md:hidden">
            {data.items.map((u: any) => <article key={u.id} aria-label={t("حساب ") + u.email} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-[140px] flex-1 break-words font-bold text-slate-900"><bdi>{[u.patient?.firstName ?? u.doctor?.firstName ?? u.assistant?.firstName, u.patient?.lastName ?? u.doctor?.lastName ?? u.assistant?.lastName].filter(Boolean).join(" ") || u.email}</bdi></h2>{actions(u)}</div>
              <p className="text-xs text-slate-600">{u.patient&&t("ملف مريض ")}{u.doctor&&t(" · ملف طبيب")}{u.assistant&&t(" · ملف مساعد")}</p>{(u.doctor?.clinic??u.assistant?.clinic??u.assistant?.doctor?.clinic)&&<p className="text-xs text-slate-600">{t("العيادة: ")}{(u.doctor?.clinic??u.assistant?.clinic??u.assistant?.doctor?.clinic).nameAr}</p>}
              <p className="break-all text-sm text-slate-600"><bdi dir="ltr">{u.email}</bdi></p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm"><dt className="text-slate-600">{t("الهاتف")}</dt><dd><bdi dir="ltr">{u.phone ?? "—"}</bdi></dd><dt className="text-slate-600">{t("الدور")}</dt><dd>{t(ROLE_LABELS[u.role as Role])}</dd></dl>
              <div className="flex flex-wrap gap-2"><span className={"badge " + (u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>{u.isActive ? t("مفعّل") : t("معطّل")}</span>{u.patient?.blocks?.length > 0 && <span className="badge bg-red-100 text-red-700">{t("محظور من الحجز")}</span>}</div>
            </article>)}
          </div>
          <div className="card hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-start text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("البريد الإلكتروني")}</th>
                  <th className="px-4 py-3 font-semibold">{t("الهاتف")}</th>
                  <th className="px-4 py-3 font-semibold">{t("الدور")}</th>
                  <th className="px-4 py-3 font-semibold">{t("الحالة")}</th>
                  <th className="px-4 py-3 font-semibold">{t("إجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u: any) => (
                  <tr key={u.id} className={id === u.id ? "bg-primary-50" : undefined}>
                    <td className="px-4 py-3 text-slate-700"><p className="font-bold"><bdi>{[u.patient?.firstName??u.doctor?.firstName??u.assistant?.firstName,u.patient?.lastName??u.doctor?.lastName??u.assistant?.lastName].filter(Boolean).join(" ")||"—"}</bdi></p><bdi dir="ltr">{u.email}</bdi><p className="text-xs">{u.patient&&t("ملف مريض ")}{u.doctor&&t(" · ملف طبيب")}{u.assistant&&t(" · ملف مساعد")}</p>{(u.doctor?.clinic??u.assistant?.clinic??u.assistant?.doctor?.clinic)&&<p className="text-xs">{t("العيادة: ")}{(u.doctor?.clinic??u.assistant?.clinic??u.assistant?.doctor?.clinic).nameAr}</p>}</td>
                    <td className="px-4 py-3 text-slate-600" dir="ltr">{u.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{t(ROLE_LABELS[u.role as Role])}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {u.isActive ? t("مفعّل") : t("معطّل")}
                      </span>
                      {u.patient?.blocks?.length > 0 && <span className="badge ms-1 bg-red-100 text-red-700">{t("محظور من الحجز")}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {actions(u)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState title={!!(q || id || role) ? t("لا نتائج مطابقة") : t("لا يوجد مستخدمون")} description={!!(q || id || role) ? t("جرّب تغيير البحث أو مسح الفلاتر.") : undefined} />
      )}

      {confirmation.dialog}
      <BlockPatientDialog target={blockTarget?.t ?? null} mode={blockTarget?.mode ?? "block"} onClose={() => setBlockTarget(null)} />
    </div>
  );
}
