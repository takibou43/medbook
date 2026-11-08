import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../lib/api';
import { useAdminConfirm } from '../../components/admin/AdminConfirm';
import { Spinner, ErrorState } from '../../components/ui/States';
import { Pagination } from '../../components/ui/Pagination';
import { DAY_MS, renewalQuote, formatDuration, formatExpiry, MAX_PAYMENT_DZD } from '../../lib/subscriptionCalendar';
import { normalizeSubscriptionDigits, parseSubscriptionAmount } from '../../lib/subscriptionAmount';

const date = (s?: string | null) => s ? new Date(s).toLocaleDateString('ar-DZ', {timeZone:'Africa/Algiers'}) : 'غير مسجل';
const filters: Record<string,string> = {ALL:'الكل',TRIAL:'شهر مجاني',PAID:'مفعّل • غير تجريبي',SOON:'ينتهي خلال 7 أيام',EXPIRED:'منتهٍ',STOPPED:'موقوف',NONE:'بانتظار التفعيل',CLINIC:'اشتراك عيادة'};
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
  <header className="rounded-2xl bg-slate-900 p-6 text-white"><p className="text-sm text-teal-300">MedBook / إدارة الاشتراكات</p><h1 className="mt-2 text-3xl font-extrabold">اشتراكات الأطباء</h1></header>
  <div className="grid gap-3 sm:grid-cols-3">{[['كل الأطباء',query.data?.counts?.ALL??'—'],['تنتهي خلال 7 أيام',soon],['الشهر المجاني',query.data?.counts?.TRIAL??'—'],['منتهية',query.data?.counts?.EXPIRED??'—'],['موقوفة',query.data?.counts?.STOPPED??'—'],['أساس الاشتراك','شهر تقويمي']].map(([l,v])=><div key={l} className="card p-5"><p className="text-sm text-slate-500">{l}</p><p className="mt-2 text-2xl font-bold text-teal-700">{v}</p></div>)}</div>
  {!!soon&&<p role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900">تنبيه: {soon} اشتراكًا يقترب من الانتهاء.</p>}
  {doctorId?<button className="btn-outline" onClick={()=>{setSearchParams({});setQ('');setFilter('ALL');setPage(1);}}>عرض جميع اشتراكات الأطباء</button>:<>
  <div className="card p-4"><label className="block text-sm font-bold" htmlFor="subscription-search">البحث باسم الطبيب أو الهاتف</label><input id="subscription-search" className="input mt-2 max-w-md" placeholder="اكتب اسم الطبيب…" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/></div>
  <nav aria-label="تصفية الاشتراكات" className="flex flex-wrap gap-2">{Object.entries(filters).map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>{setFilter(key);setPage(1);}} className={filter===key?'btn-primary':'btn-outline'}>{label} <span className="text-xs">{query.data?.counts?.[key]??'—'}</span></button>)}</nav></>}
  {query.isLoading?<Spinner/>:query.isError?<ErrorState message={apiErrorMessage(query.error)} onRetry={()=>void query.refetch()}/>:<>
   {!doctors.length&&<p className="card p-8 text-center">لا يوجد أطباء مطابقون للبحث.</p>}
   <div className="space-y-4">{doctors.map((d:any)=><DoctorSubscription key={d.id} doctor={d}/>)}</div>
   <Pagination page={page} totalPages={query.data?.totalPages??1} onChange={setPage}/>
  </>}
  <p className="text-xs text-slate-500">السجل يبدأ من تاريخ اعتماد اللوحة.</p>
 </main>;
}
function DoctorSubscription({doctor:d}:{doctor:any}){
 const [open,setOpen]=useState(false),[amount,setAmount]=useState(''),[method,setMethod]=useState('CASH'),[reference,setReference]=useState(''),[paidAt,setPaidAt]=useState(new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Algiers'})),[note,setNote]=useState('');const qc=useQueryClient();const confirmation=useAdminConfirm();
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
   try{await api.post('/admin/doctors/'+d.id+'/subscription',{operation,reason:reason||undefined,...(operation==='RENEW'?{receipt:{amountDzd:parsedAmount!,method,paidAt:new Date(paidAt+'T00:00:00+01:00').toISOString(),reference:reference.trim()||undefined,note:note.trim()||undefined}}:{}),expectedVersion:d.updatedAt,expectedEnd:d.subscriptionExpiresAt??null});setAmount('');setReference('');setNote('');}
   finally{await Promise.all([qc.invalidateQueries({queryKey:['admin-doctors']}),qc.invalidateQueries({queryKey:['subscription-history',d.id]})]);}
  }});
 }
 return <article className="card overflow-hidden p-5">
 <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">د. {d.firstName} {d.lastName}</h2><p className="text-sm text-slate-500">{d.specialty?.nameAr} · {d.city?.nameAr}</p></div><span className={'rounded-full px-3 py-1 text-sm font-bold '+(status==='منتهٍ'||status==='موقوف'?'bg-red-50 text-red-700':'bg-teal-50 text-teal-800')}>{status}</span></div>
 {clinic?<p className="mt-4 text-sm">تُدار الفوترة من <a className="text-teal-700 underline" href={'/admin/clinics?id='+d.clinic.id}>{d.clinic.nameAr}</a>.</p>:<>
 <dl className="my-5 grid grid-cols-2 gap-4 lg:grid-cols-4">{[['بداية الشهر المجاني',date(d.trialStartedAt)],['انتهاء الاشتراك',date(d.subscriptionExpiresAt)],['الأيام المتبقية',end?`${days} يوم`:'غير محددة'],['الشهر المجاني الأول',d.trialStartedAt?'بدأ مرة واحدة':d.newDoctorTrial?'بانتظار أول توثيق':'غير متاح / سجل قديم']].map(([k,v])=><div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>)}</dl>
 <details className="mb-4 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-bold text-teal-800">تسجيل دفعة للتفعيل أو التجديد</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">
 <label className="text-sm">المبلغ المستلم (دج)<input className="input mt-1" type="text" inputMode="numeric" dir="ltr" autoComplete="off" placeholder="مثال: 8000 أو ٨٠٠٠" value={amount} onChange={e=>setAmount(normalizeSubscriptionDigits(e.target.value))}/></label>
 <label className="text-sm">تاريخ الدفع<input className="input mt-1" type="date" max={new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Algiers'})} value={paidAt} onChange={e=>setPaidAt(e.target.value)}/></label>
 <label className="text-sm">طريقة الدفع<select className="input mt-1" value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(methods).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label className="text-sm">مرجع العملية {method!=='CASH'?'(مطلوب)':'(اختياري)'}<input className="input mt-1" maxLength={100} value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <label className="text-sm sm:col-span-2">ملاحظة اختيارية<input className="input mt-1" maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label></div><p className="mt-3 text-xs text-slate-500">الدفع بالذهبية غير متاح حاليًا.</p></details>
 <div className="mb-4 rounded-xl bg-teal-50 p-4 text-sm text-teal-900" role="status"><p className="font-bold">5000 دج / شهر تقويمي</p>{quote?<><p className="mt-2">المدة المضافة: <b>{formatDuration(quote.durationMs)}</b></p><p>الانتهاء المتوقع: <b>{formatExpiry(quote.after)}</b></p></>:<p className="mt-2">أدخل المبلغ لعرض تاريخ الانتهاء.</p>}</div>
 <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"><button className="btn-primary" disabled={!valid||!receiptValid} onClick={()=>act('RENEW')}>{active?'تجديد الاشتراك':'تفعيل بعد الدفع'}</button>{active?<button className="btn-outline" onClick={()=>act('STOP')}>إيقاف الاشتراك</button>:days>0&&<button className="btn-outline" onClick={()=>act('RESUME')}>إعادة التفعيل دون دفع</button>}</div>
 {!receiptValid&&<p className="mt-2 text-xs text-slate-500">افتح «تسجيل دفعة» وأكمل المبلغ والتاريخ ومرجع التحويل لتفعيل زر التجديد.</p>}
 {amount!==''&&!valid&&<p className="mt-2 text-sm text-red-700">أدخل مبلغًا صحيحًا من 1 إلى 600000 دج.</p>}
 </>}
 <button className="mt-4 text-sm font-bold text-teal-700" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'إخفاء':'عرض'} سجل التفعيل والتجديد</button>
 {open&&<section className="mt-4 border-t pt-4">{history.isLoading?<Spinner/>:history.isError?<ErrorState message={apiErrorMessage(history.error)} onRetry={()=>void history.refetch()}/>:<><p className="mb-3 font-bold">المدة المدفوعة المسجلة: {formatDuration((history.data??[]).reduce((sum:number,r:any)=>sum+(r.meta?.durationMs??(r.meta?.months??0)*30*DAY_MS),0))} <span className="text-xs font-normal">(السجل السابق غير مكتمل)</span></p>{!(history.data??[]).length&&<p>لا توجد عمليات مسجلة في السجل الجديد.</p>}{(history.data??[]).map((r:any)=><div key={r.id} className="mb-2 rounded-lg bg-slate-50 p-3 text-sm"><b>{labels[r.meta?.operation]??'تعديل'}</b> · {date(r.createdAt)} · {formatDuration(r.meta?.durationMs??(r.meta?.months??0)*30*DAY_MS)}<p>{r.meta?.receipt?`${r.meta.receipt.amountDzd} دج · ${methods[r.meta.receipt.method]??r.meta.receipt.method} · ${date(r.meta.receipt.paidAt)} · ${r.meta.receipt.reference??"دون مرجع"}`:"لم تسجّل بيانات دفعة"}</p>{r.meta?.pricingBasis==='CALENDAR_MONTH'&&<p>حساب بالأشهر التقويمية الفعلية</p>}{r.meta?.reason&&<p>السبب: {r.meta.reason}</p>}<p>الانتهاء: {r.meta?.beforeEnd?formatExpiry(r.meta.beforeEnd):'غير مسجل'} ← {r.meta?.afterEnd?formatExpiry(r.meta.afterEnd):'غير مسجل'}</p><p className="text-xs text-slate-500">بواسطة {r.user?.email??'الإدارة'}</p></div>)}</>}</section>}
 {confirmation.dialog}
 </article>;
}
