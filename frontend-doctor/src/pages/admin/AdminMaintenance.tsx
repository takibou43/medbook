import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api,apiErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Spinner,ErrorState,EmptyState } from '../../components/ui/States';
import { useAdminConfirm } from '../../components/admin/AdminConfirm';
export default function AdminMaintenance(){
  useLanguage();
 const qc=useQueryClient(),confirmation=useAdminConfirm(),[done,setDone]=useState<number|null>(null);
 const query=useQuery({queryKey:['admin-demo-preview'],queryFn:async()=>(await api.get('/admin/maintenance/demo-preview')).data.data});
 const eligible=(query.data?.records??[]).filter((r:any)=>r.eligible);
 function purge(){confirmation.ask({title:t("تنظيف السجلات التجريبية المحددة"),record:eligible.map((r:any)=>r.email).join(t("، ")),reasonRequired:true,impact:t("حذف نهائي لعدد {0} حساب من المعاينة دون سجلات مواعيد أو عائلة مرتبطة. يمنع الخادم الحسابات الإدارية والعيادات وأي تغير بعد المعاينة.", { "0": eligible.length }),action:async(reason)=>{const res=await api.post('/admin/maintenance/purge-demo-data',{reason,records:eligible.map((r:any)=>({id:r.id,version:r.version}))});setDone(res.data.data.users);await qc.invalidateQueries({queryKey:['admin-demo-preview']});}});}
 return <section className="space-y-5"><h1 className="text-2xl font-extrabold">{t("صيانة البيانات التجريبية")}</h1><Link to="/admin" className="text-primary-700 underline">{t("العودة إلى الرئيسية")}</Link><p className="text-sm text-slate-600">{t("البريد وحده لا يثبت أن الحساب تجريبي. تُعرض فقط السجلات المحددة صراحة، مع آثار الحذف وقيود السجلات المرتبطة.")}</p><Button variant="outline" onClick={()=>void query.refetch()}>{t("تحديث المعاينة")}</Button>{query.isLoading?<Spinner/>:query.isError?<ErrorState message={apiErrorMessage(query.error)} onRetry={()=>void query.refetch()}/>:query.data?.records.length?<div className="space-y-3">{query.data.records.map((r:any)=><article key={r.id} className="card space-y-2 p-4"><p><bdi dir="ltr">{r.email}</bdi></p><p className="text-sm">{t("المواعيد: ")}{r.appointments}{t(" · سجلات العائلة والعلاج: ")}{r.medicalRecords}</p><p className="text-sm">{r.eligible?t("مؤهل ضمن النطاق المحدد"):t("محمي بسبب الدور أو العيادة أو سجلات مرتبطة")}</p></article>)}<Button variant="danger" disabled={!eligible.length} onClick={purge}>{t("حذف الحسابات المؤهلة المحددة")}</Button></div>:<EmptyState title={t("لا توجد حسابات محددة للتنظيف")} description={t("لا يُحذف أي حساب باعتماد نطاق البريد.")}/>}{done!==null&&<p role="status">{t("تم حذف ")}{done}{t(" حساب من النطاق الذي راجعته.")}</p>}{confirmation.dialog}</section>;
}
