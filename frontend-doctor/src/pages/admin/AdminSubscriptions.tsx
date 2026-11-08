import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../lib/api';
import { useAdminConfirm } from '../../components/admin/AdminConfirm';
import { Spinner, ErrorState } from '../../components/ui/States';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { DAY_MS, renewalQuote, formatDuration, formatExpiry, MAX_PAYMENT_DZD } from '../../lib/subscriptionCalendar';
import { normalizeSubscriptionDigits, parseSubscriptionAmount } from '../../lib/subscriptionAmount';

const date = (s?: string | null) => s ? new Date(s).toLocaleDateString('ar-DZ', {timeZone:'Africa/Algiers'}) : 'غير مسجل';
const filters: Record<string,string> = {ALL:'الكل',TRIAL:'شهر مجاني',PAID:'مفعّل',SOON:'ينتهي خلال 7 أيام',EXPIRED:'منتهٍ',STOPPED:'موقوف',NONE:'بانتظار التفعيل',CLINIC:'اشتراك عيادة'};
const methods: Record<string,string>={CASH:'نقدًا',CCP_TRANSFER:'تحويل بريدي',BANK_TRANSFER:'تحويل بنكي'};
const labels: Record<string,string> = { RENEW:'تفعيل / تجديد مدفوع', STOP:'إيقاف الاشتراك', RESUME:'إعادة التفعيل', EDIT:'تعديل إداري' };
export default function AdminSubscriptions(){
 const [searchParams,setSearchParams]=useSearchParams();
 const doctorId=searchParams.get('doctorId')??undefined;
 const [q,setQ]=useState(''),[page,setPage]=useState(1),[filter,setFilter]=useState('ALL');
 const query=useQuery({queryKey:['admin-doctors','subscriptions',doctorId,q,page,filter],queryFn:async({signal})=>(await api.get('/admin/subscriptions',{signal,params:{doctorId,q:q||undefined,page,pageSize:20,filter}})).data.data});
 const doctors=query.data?.items??[];
 const soon=query.data?.counts?.SOON??0;
 return <main dir="rtl" className="space-y-6">
  <header><h1 className="text-2xl font-extrabold">اشتراكات الأطباء</h1></header>
  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600"><span>الأطباء: <b>{query.data?.counts?.ALL??'—'}</b></span><span className={soon?'font-bold text-amber-800':''}>تنتهي قريبًا: <b>{soon}</b></span><span>منتهية: <b>{query.data?.counts?.EXPIRED??'—'}</b></span></div>
  {doctorId?<button className="btn-outline" onClick={()=>{setSearchParams({});setQ('');setFilter('ALL');setPage(1);}}>عرض جميع اشتراكات الأطباء</button>:<>
  <div className="flex flex-wrap items-end gap-3">
   <label className="min-w-0 flex-1 text-sm font-bold" htmlFor="subscription-search">البحث<input id="subscription-search" className="input mt-1" placeholder="اسم الطبيب أو الهاتف" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/></label>
   <label className="text-sm font-bold" htmlFor="subscription-filter">الحالة<select id="subscription-filter" className="input mt-1" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}>{Object.entries(filters).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  </div></>}
  {query.isLoading?<Spinner/>:query.isError?<ErrorState message={apiErrorMessage(query.error)} onRetry={()=>void query.refetch()}/>:<>
   {!doctors.length&&<p className="card p-8 text-center">لا يوجد أطباء مطابقون للبحث.</p>}
   <div className="space-y-2">{doctors.map((d:any)=><DoctorSubscription key={d.id} doctor={d}/>)}</div>
   <Pagination page={page} totalPages={query.data?.totalPages??1} onChange={setPage}/>
  </>}
 </main>;
}
function DoctorSubscription({doctor:d}:{doctor:any}){
 const [paymentOpen,setPaymentOpen]=useState(false),[open,setOpen]=useState(false),[amount,setAmount]=useState(''),[method,setMethod]=useState('CASH'),[reference,setReference]=useState(''),[paidAt,setPaidAt]=useState(new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Algiers'})),[note,setNote]=useState('');const qc=useQueryClient();const confirmation=useAdminConfirm();
 const history=useQuery({queryKey:['subscription-history',d.id],enabled:open,queryFn:async()=>(await api.get('/admin/doctors/'+d.id+'/subscription-history')).data.data});
 const end=d.subscriptionExpiresAt?new Date(d.subscriptionExpiresAt).getTime():0;
 const days=Math.max(0,Math.ceil((end-Date.now())/86400000));const active=d.subscriptionStatus==='ACTIVE';const clinic=!!d.clinic?.ownerId;
 const status=clinic?'اشتراك عيادة':active?(end&&days===0?'منتهٍ':d.newDoctorTrial?'الشهر المجاني':'مفعّل'):end&&days>0?'موقوف':end?'منتهٍ':'بانتظار التفعيل';
 const parsedAmount=parseSubscriptionAmount(amount,MAX_PAYMENT_DZD);
 const valid=parsedAmount!==null;
 const receiptValid=valid&&!!paidAt&&Date.parse(paidAt+'T00:00:00+01:00')<=Date.now()&&(method==='CASH'||!!reference.trim());
 const quote=valid?renewalQuote(parsedAmount,end,Date.now(),d.billingSchedule):null;
 function act(operation:'RENEW'|'STOP'|'RESUME'){
  if(operation==='RENEW'&&(!valid||!receiptValid))return;
  confirmation.ask({reasonRequired:operation==='STOP',title:labels[operation],record:'د. '+d.firstName+' '+d.lastName,confirmText:'تأكيد '+labels[operation],impact:operation==='RENEW'?`المبلغ: ${parsedAmount} دج (${methods[method]}). الانتهاء: ${formatExpiry(quote!.after)}.`:operation==='STOP'?'يتوقف الاشتراك وتبقى مدة الانتهاء كما هي.':'إعادة التفعيل للمدة المتبقية دون دفع جديد.',action:async reason=>{
   try{await api.post('/admin/doctors/'+d.id+'/subscription',{operation,reason:reason||undefined,...(operation==='RENEW'?{receipt:{amountDzd:parsedAmount!,method,paidAt:new Date(paidAt+'T00:00:00+01:00').toISOString(),reference:reference.trim()||undefined,note:note.trim()||undefined}}:{}),expectedVersion:d.updatedAt,expectedEnd:d.subscriptionExpiresAt??null});setPaymentOpen(false);setAmount('');setReference('');setNote('');}
   finally{await Promise.all([qc.invalidateQueries({queryKey:['admin-doctors']}),qc.invalidateQueries({queryKey:['subscription-history',d.id]})]);}
  }});
 }
 return <article className="card p-4">
 <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
  <div className="min-w-0"><h2 className="font-bold">د. {d.firstName} {d.lastName}</h2><p className="text-xs text-slate-500">{d.specialty?.nameAr} · {d.city?.nameAr}</p></div>
  <span className={'w-fit rounded-full px-3 py-1 text-sm font-bold '+(status==='منتهٍ'||status==='موقوف'?'bg-red-50 text-red-700':days<=7&&end&&!clinic?'bg-amber-50 text-amber-800':'bg-teal-50 text-teal-800')}>{status}</span>
  {!clinic&&<div className="text-sm"><p>ينتهي: <b dir="ltr">{date(d.subscriptionExpiresAt)}</b></p><p className="text-xs text-slate-500">{end?`المتبقي: ${days} يوم`:'لم يُفعّل بعد'}</p></div>}
  <div className="flex flex-wrap gap-2">{!clinic&&<button className="btn-primary" onClick={()=>setPaymentOpen(true)}>تسجيل دفعة</button>}<button className="btn-outline" onClick={()=>setOpen(true)}>التفاصيل</button></div>
 </div>
 {!clinic&&<Modal open={paymentOpen} onClose={()=>setPaymentOpen(false)} title="تسجيل دفعة" footer={<><button className="btn-outline" onClick={()=>setPaymentOpen(false)}>إلغاء</button><button className="btn-primary" disabled={!receiptValid} onClick={()=>act('RENEW')}>متابعة</button></>}>
 <div dir="rtl" className="space-y-4">
 <p className="font-bold">د. {d.firstName} {d.lastName}</p>
 <div className="grid gap-3 sm:grid-cols-2">
 <label className="text-sm">المبلغ المستلم (دج)<input className="input mt-1" type="text" inputMode="numeric" dir="ltr" autoComplete="off" placeholder="8000" value={amount} onChange={e=>setAmount(normalizeSubscriptionDigits(e.target.value))}/></label>
 <label className="text-sm">تاريخ الدفع<input className="input mt-1" type="date" max={new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Algiers'})} value={paidAt} onChange={e=>setPaidAt(e.target.value)}/></label>
 <label className="text-sm sm:col-span-2">طريقة الدفع<select className="input mt-1" value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(methods).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 {method!=='CASH'&&<label className="text-sm sm:col-span-2">مرجع التحويل (مطلوب)<input className="input mt-1" maxLength={100} value={reference} onChange={e=>setReference(e.target.value)}/></label>}
 </div>
 <details className="text-sm"><summary className="cursor-pointer text-slate-600">بيانات إضافية (اختياري)</summary><div className="mt-3 space-y-3">
 {method==='CASH'&&<label className="block">مرجع العملية<input className="input mt-1" maxLength={100} value={reference} onChange={e=>setReference(e.target.value)}/></label>}
 <label className="block">ملاحظة<input className="input mt-1" maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
 </div></details>
 <div className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900" role="status"><p>5000 دج / شهر</p>{quote&&<p className="mt-1 font-bold">الانتهاء الجديد: {formatExpiry(quote.after)}</p>}</div>
 {amount!==''&&!valid&&<p role="alert" className="text-sm text-red-700">أدخل مبلغًا صحيحًا من 1 إلى 600000 دج.</p>}
 {!!paidAt&&Date.parse(paidAt+'T00:00:00+01:00')>Date.now()&&<p role="alert" className="text-sm text-red-700">تاريخ الدفع لا يمكن أن يكون في المستقبل.</p>}
 </div>
 </Modal>}
 <Modal open={open} onClose={()=>setOpen(false)} title="تفاصيل الاشتراك">
 <div dir="rtl" className="space-y-4">
 <h2 className="font-bold">د. {d.firstName} {d.lastName}</h2>
 {clinic?<p className="text-sm">تُدار الفوترة من <a className="text-teal-700 underline" href={'/admin/clinics?id='+d.clinic.id}>{d.clinic.nameAr}</a>.</p>:<>
 <dl className="grid grid-cols-2 gap-4 text-sm">{[['بداية الشهر المجاني',date(d.trialStartedAt)],['انتهاء الاشتراك',date(d.subscriptionExpiresAt)],['الأيام المتبقية',end?`${days} يوم`:'غير محددة'],['الشهر المجاني',d.trialStartedAt?'استُفيد منه':d.newDoctorTrial?'بانتظار أول توثيق':'غير مسجل']].map(([k,v])=><div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>)}</dl>
 <div className="flex flex-wrap gap-2">{active?<button className="btn-outline" onClick={()=>act('STOP')}>إيقاف الاشتراك</button>:days>0&&<button className="btn-outline" onClick={()=>act('RESUME')}>إعادة التفعيل</button>}</div>
 </>}
 <h3 className="font-bold">سجل الدفعات والتجديد</h3>
 {open&&<section className="mt-4 border-t pt-4">{history.isLoading?<Spinner/>:history.isError?<ErrorState message={apiErrorMessage(history.error)} onRetry={()=>void history.refetch()}/>:<><p className="mb-3 font-bold">المدة المدفوعة المسجلة: {formatDuration((history.data??[]).reduce((sum:number,r:any)=>sum+(r.meta?.durationMs??(r.meta?.months??0)*30*DAY_MS),0))} <span className="text-xs font-normal">(السجل السابق غير مكتمل)</span></p>{!(history.data??[]).length&&<p>لا توجد عمليات مسجلة في السجل الجديد.</p>}{(history.data??[]).map((r:any)=><div key={r.id} className="mb-2 rounded-lg bg-slate-50 p-3 text-sm"><b>{labels[r.meta?.operation]??'تعديل'}</b> · {date(r.createdAt)} · {formatDuration(r.meta?.durationMs??(r.meta?.months??0)*30*DAY_MS)}<p>{r.meta?.receipt?`${r.meta.receipt.amountDzd} دج · ${methods[r.meta.receipt.method]??r.meta.receipt.method} · ${date(r.meta.receipt.paidAt)} · ${r.meta.receipt.reference??"دون مرجع"}`:"لم تسجّل بيانات دفعة"}</p>{r.meta?.pricingBasis==='CALENDAR_MONTH'&&<p>حساب بالأشهر التقويمية الفعلية</p>}{r.meta?.reason&&<p>السبب: {r.meta.reason}</p>}<p>الانتهاء: {r.meta?.beforeEnd?formatExpiry(r.meta.beforeEnd):'غير مسجل'} ← {r.meta?.afterEnd?formatExpiry(r.meta.afterEnd):'غير مسجل'}</p><p className="text-xs text-slate-500">بواسطة {r.user?.email??'الإدارة'}</p></div>)}</>}</section>}
 </div>
 </Modal>
 {confirmation.dialog}
 </article>;
}
