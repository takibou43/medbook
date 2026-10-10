import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale, catalogName } from "../../i18n/locale.ts";
import { useState } from "react";
import { useAdminConfirm } from "../../components/admin/AdminConfirm";
import { AdminResults, AdminActions } from "../../components/admin/AdminUI";
import { useAdminListParams } from "../../hooks/useAdminListParams";

import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { VerificationBadge, SubscriptionBadge } from "../../components/ui/Badge";
import { useToast } from "../../components/ui/Toast";
import { Pagination } from "../../components/ui/Pagination";
import { VerificationStatus, SubscriptionStatus } from "../../types";

export default function AdminDoctors() {
  useLanguage();
  const confirmation=useAdminConfirm();
  const { params, q, setQ, search, page, setPage, update, clear } = useAdminListParams();
  const id = params.get("id");
  const status = ["PENDING", "VERIFIED", "REJECTED"].includes(params.get("status") ?? "") ? params.get("status") as VerificationStatus : "";
  const setStatus = (value: string) => update("status", value);
  const { showToast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-doctors", search, status, page, id],
    queryFn: async ({ signal }) =>
      (await api.get("/admin/doctors", { signal, params: { id: id || undefined, q: search || undefined, verificationStatus: status || undefined, page } })).data.data,
  });

  function setVerification(d:any,status:VerificationStatus){confirmation.ask({title:status==='VERIFIED'?t("توثيق الطبيب"):t("رفض التوثيق"),record:t("د. ")+d.firstName+' '+d.lastName,reasonRequired:status==='REJECTED',impact:status==='VERIFIED'?t("قد يبدأ التوثيق فترة التجربة ومكافأة الإحالة وفق السياسة الحالية مرة واحدة؛ لا يؤكد دفع اشتراك."):t("يرفض التوثيق فقط؛ يبقى الحساب والملفات والمواعيد محفوظة."),action:async reason=>{await api.patch('/admin/doctors/'+d.id+'/verify',{status,reason:reason||undefined});showToast(t("تم تحديث حالة التوثيق."),'success');await qc.invalidateQueries({queryKey:['admin-doctors']});}});}
  function setSubscription(d:any,status:SubscriptionStatus){confirmation.ask({title:status==='ACTIVE'?t("تفعيل الاشتراك"):t("إيقاف الاشتراك"),record:t("د. ")+d.firstName+' '+d.lastName,impact:t("يغير الاشتراك الفردي فقط. تحقق من الدفع قبل التفعيل؛ تبقى المواعيد والملفات محفوظة."),action:async()=>{await api.patch('/admin/doctors/'+d.id,{subscriptionStatus:status});showToast(t("تم تحديث الاشتراك."),'success');await qc.invalidateQueries({queryKey:['admin-doctors']});}});}

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">{t("إدارة الأطباء")}</h1>
      {id && <p className="text-sm text-primary-700" role="status">{t("عرض السجل المحدد من الرابط")}</p>}

      <div className="flex flex-wrap gap-3">
        <Input label={t("بحث عن طبيب")} placeholder={t("بحث بالاسم...")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select aria-label={t("حالة توثيق الطبيب")} className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value as VerificationStatus | "")}>
          <option value="">{t("كل الحالات")}</option>
          <option value="PENDING">{t("قيد المراجعة")}</option>
          <option value="VERIFIED">{t("موثّق")}</option>
          <option value="REJECTED">{t("مرفوض")}</option>
        </select>
      </div>

      <AdminResults total={data?.total} filtered={!!(q || id || status)} onClear={clear} />

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} onRetry={() => void refetch()} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-3">
            {data.items.map((d: any) => (
              <div key={d.id} id={`doctor-${d.id}`} className="card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-slate-800">{t("د. ")}{d.firstName} {d.lastName} — {catalogName(d.specialty)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {d.user?.email} — {d.city?.nameAr}{t("، ")}{catalogName(d.wilaya)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={"badge "+(d.user?.isActive?"bg-green-100 text-green-700":"bg-red-100 text-red-700")}>{d.user?.isActive?t("الحساب مفعّل"):t("الحساب معطّل")}</span>
                  <VerificationBadge status={d.verificationStatus} />
                  {d.clinic?.ownerId ? <Link to={"/admin/clinics?id="+d.clinic.id} className="text-sm text-primary-700">{t("اشتراك ")}{d.clinic.nameAr}</Link> : <SubscriptionBadge status={d.subscriptionStatus ?? "UNPAID"} />}
                  <Link to={`/admin/messages?doctor=${d.id}`} className="btn-outline !px-3 !py-1.5 text-xs">{t("مراسلة")}</Link>
                  <AdminActions label={t("الطبيب ") + d.firstName + " " + d.lastName}>
                  {d.verificationStatus !== "VERIFIED" && (
                    <Button onClick={() => setVerification(d, "VERIFIED")}>{t("توثيق")}</Button>
                  )}
                  {d.verificationStatus !== "REJECTED" && (
                    <Button variant="danger" onClick={() => setVerification(d, "REJECTED")}>{t("رفض ")}</Button>
                  )}
                  {d.clinic?.ownerId ? null : d.subscriptionStatus !== "ACTIVE" ? (
                    <Button variant="outline" onClick={() => setSubscription(d, "ACTIVE")}>{t("تفعيل الاشتراك ")}</Button>
                  ) : (
                    <Button variant="outline" onClick={() => setSubscription(d, "UNPAID")}>{t("إيقاف الاشتراك ")}</Button>
                  )}
                  </AdminActions>
                </div>
                <DoctorDetails doctor={d}/>
              </div>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState title={!!(q || id || status) ? t("لا نتائج مطابقة") : t("لا يوجد أطباء")} description={!!(q || id || status) ? t("جرّب تغيير البحث أو مسح الفلاتر.") : undefined} />
      )}
      {confirmation.dialog}
    </div>
  );
}

function DoctorDetails({doctor:d}:{doctor:any}){
  useLanguage();const [open,setOpen]=useState(false);const history=useQuery({queryKey:['admin-doctor-history',d.id],enabled:open,queryFn:async()=>(await api.get('/admin/doctors/'+d.id+'/history')).data.data});return <details className="text-sm sm:basis-full" onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-primary-700">{t("تفاصيل الطبيب")}</summary><div className="mt-2 space-y-2"><p>{t("العيادة: ")}{d.clinic?.nameAr??t("طبيب مستقل")}{t(" · نوع الاشتراك: ")}{d.clinic?.ownerId?t("اشتراك عيادة"):t("فردي")}</p><p>{t("انتهاء الاشتراك الفردي: ")}{d.subscriptionExpiresAt?new Date(d.subscriptionExpiresAt).toLocaleDateString(getLocale()):t("غير محدد")}</p><p><bdi dir="ltr">{d.user?.phone??'—'}</bdi></p>{history.isLoading?<Spinner/>:history.isError?<ErrorState message={apiErrorMessage(history.error)} onRetry={()=>void history.refetch()}/>:<div>{(history.data??[]).map((r:any)=><p key={r.id}>{r.status==='REJECTED'?t("رفض التوثيق"):r.status==='VERIFIED'?t("توثيق"):t("قيد المراجعة")} — {new Date(r.at).toLocaleString(getLocale())}{t(" · السبب: ")}{r.reason??t("غير مسجل")}</p>)}</div>}</div></details>;}
