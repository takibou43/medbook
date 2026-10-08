import { loadAdminDoctorOptions } from '../../components/admin/doctorOptions';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { api,apiErrorMessage } from '../../lib/api';
import { AdminActions,AdminResults } from '../../components/admin/AdminUI';
import { useAdminConfirm } from '../../components/admin/AdminConfirm';
import { useAdminListParams } from '../../hooks/useAdminListParams';
import { Input,Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { RatingStars } from '../../components/ui/RatingStars';
import { Spinner,EmptyState,ErrorState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { Link } from 'react-router-dom';
type Review={id:string;rating:number;comment?:string;createdAt:string;appointmentId?:string;doctor:{firstName:string;lastName:string};patient:{firstName:string;lastName:string}};
export default function AdminReviews(){
 const qc=useQueryClient(),{showToast}=useToast(),confirmation=useAdminConfirm(),{params,q,setQ,search,page,setPage,update,clear}=useAdminListParams();
 const rating=params.get('rating')??'',doctorId=params.get('doctorId')??'',from=params.get('from')??'',to=params.get('to')??'';
 const query=useQuery({queryKey:['admin-reviews',search,rating,doctorId,from,to,page],queryFn:async({signal})=>(await api.get('/admin/reviews',{signal,params:{q:search||undefined,rating:rating||undefined,doctorId:doctorId||undefined,from:from||undefined,to:to||undefined,page}})).data.data as {items:Review[];total:number;page:number;totalPages:number}});
 const doctors=useQuery({queryKey:['admin-doctor-options'],queryFn:({signal})=>loadAdminDoctorOptions(signal)});
 function remove(r:Review){confirmation.ask({title:'حذف التقييم',record:`${r.patient.firstName} ${r.patient.lastName} — د. ${r.doctor.firstName} ${r.doctor.lastName}`,reasonRequired:true,impact:'الحذف نهائي ويعيد حساب متوسط الطبيب. لا يُحذف التقييم لمجرد أنه سلبي؛ أدخل سببًا وفق سياسة الإشراف.',action:async reason=>{await api.delete('/admin/reviews/'+r.id,{data:{reason}});showToast('تم حذف التقييم.','success');await qc.invalidateQueries({queryKey:['admin-reviews']});}});}
 const filtered=!!(q||rating||doctorId||from||to);
 return <div className="space-y-5"><h1 className="text-2xl font-extrabold">إدارة التقييمات</h1><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Input label="بحث باسم الطبيب أو التعليق" value={q} onChange={e=>setQ(e.target.value)}/><Select label="الطبيب" value={doctorId} onChange={e=>update('doctorId',e.target.value)}><option value="">كل الأطباء</option>{(doctors.data?.items??[]).map((d:any)=><option key={d.id} value={d.id}>د. {d.firstName} {d.lastName}</option>)}</Select><Select label="درجة التقييم" value={rating} onChange={e=>update('rating',e.target.value)}><option value="">كل الدرجات</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} من 5</option>)}</Select><Input label="من تاريخ" type="date" value={from} onChange={e=>update('from',e.target.value)}/><Input label="إلى تاريخ" type="date" min={from||undefined} value={to} onChange={e=>update('to',e.target.value)}/></div><AdminResults total={query.data?.total} filtered={filtered} onClear={clear}/>{query.isLoading?<Spinner/>:query.isError?<ErrorState message={apiErrorMessage(query.error)} onRetry={()=>void query.refetch()}/>:query.data?.items.length?<><div className="space-y-3">{query.data.items.map(r=><article key={r.id} className="card flex flex-wrap items-start justify-between gap-4 p-4"><div className="min-w-0 space-y-2"><h2 className="font-bold"><bdi>{r.patient.firstName} {r.patient.lastName} ← د. {r.doctor.firstName} {r.doctor.lastName}</bdi></h2><RatingStars value={r.rating}/>{r.comment&&<p className="break-words text-sm">{r.comment}</p>}<p className="text-xs text-slate-600">{new Date(r.createdAt).toLocaleString('ar-DZ')}</p>{r.appointmentId&&<Link className="text-sm text-primary-700 underline" to={'/admin/appointments?id='+r.appointmentId}>عرض الموعد المرتبط</Link>}</div><AdminActions label={'تقييم '+r.patient.firstName+' '+r.patient.lastName}><Button variant="danger" aria-label={'حذف تقييم '+r.patient.firstName+' '+r.patient.lastName} onClick={()=>remove(r)}>حذف التقييم</Button></AdminActions></article>)}</div><Pagination page={query.data.page} totalPages={query.data.totalPages} onChange={setPage}/></>:<EmptyState title={filtered?'لا نتائج مطابقة':'لا توجد تقييمات'}/>} {confirmation.dialog}</div>;
}
