import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale } from "../../i18n/locale.ts";
import { FormEvent,useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { api,apiErrorMessage } from '../../lib/api';
import { Input,Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { Spinner,EmptyState,ErrorState } from '../../components/ui/States';
import { AdminResults,AdminActions } from '../../components/admin/AdminUI';
import { useAdminConfirm } from '../../components/admin/AdminConfirm';
import { useAdminListParams } from '../../hooks/useAdminListParams';
import { useToast } from '../../components/ui/Toast';
type Clinic={id:string;nameAr:string;address:string;owner:{email:string};verificationStatus:string;subscriptionStatus:string;subscriptionExpiresAt:string|null;paidDoctorCount:number;_count:{doctors:number};monthlyTotal:number;doctorPrice:number;billedDoctorCount:number;discountedDoctorCount:number;referralDiscountUntil:string|null;pendingReferralDays:number;doctors:{id:string;firstName:string;lastName:string}[];revision:string};
const verification:Record<string,string>={PENDING:'قيد المراجعة',VERIFIED:'موثّقة',REJECTED:'مرفوضة'},subscription:Record<string,string>={UNPAID:'غير مفعّل',ACTIVE:'نشط',EXPIRED:'منتهي'};
export default function AdminClinics(){
  useLanguage();
 const qc=useQueryClient(),{showToast}=useToast(),confirmation=useAdminConfirm(),{params,q,setQ,search,page,setPage,update,clear}=useAdminListParams(),[formError,setFormError]=useState<{id:string;message:string}|null>(null);
 const [selected,setSelected]=useState<{clinic:Clinic;mode:'edit'|'details'}|null>(null);
 const id=params.get('id'),verificationStatus=params.get('verificationStatus')??'',subscriptionStatus=params.get('subscriptionStatus')??'';
 const query=useQuery({queryKey:['admin-clinics',search,page,id,verificationStatus,subscriptionStatus],queryFn:async({signal})=>(await api.get('/clinics/admin/list',{signal,params:{page,q:search||undefined,id:id||undefined,verificationStatus:verificationStatus||undefined,subscriptionStatus:subscriptionStatus||undefined}})).data.data as {items:Clinic[];total:number;page:number;totalPages:number}});
 const transfers=useQuery({queryKey:['admin-clinic-transfers'],queryFn:async()=>(await api.get('/clinics/admin/transfers')).data.data as {id:string;clinic:{nameAr:string};doctor:{firstName:string;lastName:string;user:{email:string}}}[]});
 function review(r:any,approve:boolean){confirmation.ask({title:approve?t("الموافقة على الانتقال"):t("رفض طلب الانتقال"),record:t("د. ")+r.doctor.firstName+' '+r.doctor.lastName+' — '+r.clinic.nameAr,impact:approve?t("ينقل الطبيب إلى اشتراك العيادة بعد تحقق الخادم من موافقة المالك والتوثيق والسعة."):t("يرفض الطلب ويحتفظ بحساب الطبيب واشتراكه الحالي."),action:async()=>{await api.patch('/clinics/admin/transfers/'+r.id,{approve});showToast(approve?t("تمت الموافقة ونقل الطبيب."):t("رُفض الطلب."),'success');await Promise.all([qc.invalidateQueries({queryKey:['admin-clinics']}),qc.invalidateQueries({queryKey:['admin-clinic-transfers']})]);}});}
 function preview(e:FormEvent<HTMLFormElement>,c:Clinic){e.preventDefault();const f=new FormData(e.currentTarget),count=Number(f.get('paidDoctorCount')),expires=String(f.get('expires')??''),status=String(f.get('subscriptionStatus')),verificationStatus=String(f.get('verificationStatus'));if(!Number.isInteger(count)||count<0||count>1000||(status==='ACTIVE'&&(count<c._count.doctors||count<1||!expires||new Date(expires+'T23:59:59.999Z')<=new Date()))){setFormError({id:c.id,message:t("الاشتراك النشط يتطلب سعة تشمل الأطباء الحاليين وتاريخ انتهاء مستقبليًا. القيم السالبة أو غير الصحيحة غير مقبولة.")});return;}setFormError(null);confirmation.ask({title:t("مراجعة تغييرات العيادة"),record:c.nameAr,impact:t("مراجعة العيادة: {0} ← {1}. الاشتراك: {2} ← {3}. السعة المدفوعة: {4} ← {5}. الانتهاء: {6} ← {7}. عدد الأطباء الحاليين {8}. التفعيل يتطلب تحققًا يدويًا من الدفع؛ لا يُسجل تحصيل تلقائي.", { "0": verification[c.verificationStatus], "1": verification[verificationStatus], "2": subscription[c.subscriptionStatus], "3": subscription[status], "4": c.paidDoctorCount, "5": count, "6": c.subscriptionExpiresAt?.slice(0,10)??t('غير محدد'), "7": expires||t('غير محدد'), "8": c._count.doctors }),confirmText:t("حفظ التغييرات بعد المراجعة"),action:async()=>{await api.patch('/clinics/admin/'+c.id,{verificationStatus,subscriptionStatus:status,paidDoctorCount:count,subscriptionExpiresAt:expires?expires+'T23:59:59.999Z':null,expectedSnapshot:c.revision});setSelected(null);showToast(t("تم حفظ مراجعة العيادة واشتراكها."),'success');await qc.invalidateQueries({queryKey:['admin-clinics']});}});}
 const c=selected?.clinic;
 const filtered=!!(q||id||verificationStatus||subscriptionStatus);
 return <section className="space-y-5"><h1 className="text-2xl font-extrabold">{t("العيادات والاشتراكات")}</h1><div className="grid gap-3 sm:grid-cols-3"><Input label={t("بحث عن عيادة أو مالك")} value={q} onChange={e=>setQ(e.target.value)}/><Select label={t("مراجعة العيادة")} value={verificationStatus} onChange={e=>update('verificationStatus',e.target.value)}><option value="">{t("كل الحالات")}</option>{Object.entries(verification).map(([k,v])=><option key={k} value={k}>{t(v)}</option>)}</Select><Select label={t("اشتراك العيادة")} value={subscriptionStatus} onChange={e=>update('subscriptionStatus',e.target.value)}><option value="">{t("كل الاشتراكات")}</option>{Object.entries(subscription).map(([k,v])=><option key={k} value={k}>{t(v)}</option>)}</Select></div>
 <details className="card p-4"><summary className="cursor-pointer font-bold">{t("طلبات انتقال الأطباء المسجّلين (")}{transfers.data?.length??'—'})</summary><div className="mt-3 space-y-3">{transfers.isLoading?<Spinner/>:transfers.isError?<ErrorState message={apiErrorMessage(transfers.error)} onRetry={()=>void transfers.refetch()}/>:transfers.data?.length?transfers.data.map(r=><article key={r.id} className="space-y-2 border-t pt-3"><p>{t("د. ")}{r.doctor.firstName} {r.doctor.lastName} ← {r.clinic.nameAr}</p><p><bdi dir="ltr">{r.doctor.user.email}</bdi></p><AdminActions label={t("طلب انتقال ")+r.doctor.firstName+' '+r.doctor.lastName}><Button onClick={()=>review(r,true)}>{t("الموافقة على الانتقال")}</Button><Button variant="danger" onClick={()=>review(r,false)}>{t("رفض الطلب")}</Button></AdminActions></article>):<EmptyState title={t("لا توجد طلبات معلّقة")}/>}</div></details>
 <AdminResults total={query.data?.total} filtered={filtered} onClear={clear}/>
 {query.isLoading?<Spinner/>:query.isError?<ErrorState message={apiErrorMessage(query.error)} onRetry={()=>void query.refetch()}/>:query.data?.items.length?<>
 <div className="space-y-2">{query.data.items.map(clinic=><article key={clinic.id} className="card grid items-center gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
 <div className="min-w-0"><h2 className="font-bold">{clinic.nameAr}</h2><p className="text-xs text-slate-500">{t("الأطباء: ")}{clinic._count.doctors}</p></div>
 <span className={'w-fit rounded-full px-3 py-1 text-sm font-bold '+(clinic.subscriptionStatus==='ACTIVE'?'bg-teal-50 text-teal-800':'bg-red-50 text-red-700')}>{t(subscription[clinic.subscriptionStatus])}</span>
 <div className="text-sm"><p>{t("ينتهي: ")}<b>{clinic.subscriptionExpiresAt?new Date(clinic.subscriptionExpiresAt).toLocaleDateString(getLocale()):t("غير محدد")}</b></p><p className="text-xs text-slate-500">{t("التقدير الشهري: ")}<bdi dir="ltr">{clinic.monthlyTotal.toLocaleString(getLocale())}</bdi>{t(" دج")}</p></div>
 <div className="flex flex-wrap gap-2"><Button onClick={()=>{setFormError(null);setSelected({clinic,mode:'edit'});}}>{t("تعديل الاشتراك")}</Button><Button variant="outline" onClick={()=>setSelected({clinic,mode:'details'})}>{t("التفاصيل")}</Button></div>
 </article>)}</div>
 <Pagination page={query.data.page} totalPages={query.data.totalPages} onChange={setPage}/>
 </>:<EmptyState title={filtered?t("لا نتائج مطابقة"):t("لا توجد عيادات")}/>}
 {c&&selected&&<Modal open={true} onClose={()=>setSelected(null)} title={t(selected.mode==='edit'?"تعديل اشتراك العيادة":"تفاصيل العيادة")}>
 <h2 className="mb-4 font-bold">{c.nameAr}</h2>
 {selected.mode==='edit'?<form key={c.id+'-'+c.revision} onSubmit={e=>preview(e,c)} className="space-y-4">
 <div className="grid gap-3 sm:grid-cols-2">
 <Select name="subscriptionStatus" label={t("حالة الاشتراك")} defaultValue={c.subscriptionStatus}>{Object.entries(subscription).map(([k,v])=><option key={k} value={k}>{t(v)}</option>)}</Select>
 <Input name="paidDoctorCount" label={t("عدد الأطباء المشمولين")} type="number" min={0} max={1000} defaultValue={c.paidDoctorCount} required/>
 <Input name="expires" label={t("تاريخ الانتهاء")} type="date" defaultValue={c.subscriptionExpiresAt?.slice(0,10)??''}/>
 </div>
 <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold">{t("توثيق العيادة")}: {t(verification[c.verificationStatus])}</summary><div className="mt-3"><Select name="verificationStatus" label={t("قرار التوثيق")} defaultValue={c.verificationStatus}>{Object.entries(verification).map(([k,v])=><option key={k} value={k}>{t(v)}</option>)}</Select></div></details>
 <p className="text-sm text-slate-600">{t("فعّل الاشتراك بعد التحقق من الدفع.")}</p>
 {formError?.id===c.id&&<p role="alert" className="text-sm text-red-700">{formError.message}</p>}
 <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setSelected(null)}>{t("إلغاء")}</Button><Button type="submit">{t("مراجعة وحفظ")}</Button></div>
 </form>:<div className="space-y-4 text-sm">
 <p>{c.address}</p><p><bdi dir="ltr">{c.owner.email}</bdi></p>
 <dl className="grid grid-cols-2 gap-4">
 {[['مراجعة العيادة',verification[c.verificationStatus]],['اشتراك العيادة',subscription[c.subscriptionStatus]],['الأطباء الحاليون',String(c._count.doctors)],['السعة المشمولة بالدفع',String(c.paidDoctorCount)]].map(([label,value])=><div key={label}><dt className="text-slate-500">{t(label)}</dt><dd className="mt-1 font-bold">{t(value)}</dd></div>)}
 </dl>
 <div className="border-t pt-3"><h3 className="font-bold">{t("الأطباء")}</h3><ul className="mt-2 space-y-1">{(c.doctors??[]).map(d=><li key={d.id}>{t("د. ")}{d.firstName} {d.lastName}</li>)}</ul></div>
 <details className="border-t pt-3"><summary className="cursor-pointer font-bold">{t("تفاصيل التسعير")}</summary><div className="mt-3 space-y-2">
 <p>{c.billedDoctorCount}{t(" طبيب × ")}<bdi dir="ltr">{c.doctorPrice.toLocaleString(getLocale())}</bdi>{t(" دج = ")}<bdi dir="ltr">{c.monthlyTotal.toLocaleString(getLocale())}</bdi>{t(" دج")}</p>
 <p className="text-slate-600">{t("المبلغ تقدير شهري وليس إثبات تحصيل.")}</p>
 {c.discountedDoctorCount>0&&<p>{t("خصم الإحالة يشمل ")}{c.discountedDoctorCount}{t(" طبيب حتى ")}{c.referralDiscountUntil?new Date(c.referralDiscountUntil).toLocaleDateString(getLocale()):'—'}</p>}
 {c.pendingReferralDays>0&&<p>{t("خصم محفوظ لمدة ")}{c.pendingReferralDays}{t(" يومًا يبدأ عند تفعيل الاشتراك.")}</p>}
 </div></details>
 </div>}
 </Modal>}
 {confirmation.dialog}</section>;
}
