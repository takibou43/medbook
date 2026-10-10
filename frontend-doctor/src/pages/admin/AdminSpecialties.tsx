import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api,apiErrorMessage } from '../../lib/api';
import { AdminActions,AdminResults } from '../../components/admin/AdminUI';
import { useAdminConfirm } from '../../components/admin/AdminConfirm';
import { useAdminListParams } from '../../hooks/useAdminListParams';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner,EmptyState,ErrorState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
type Specialty={id:string;nameAr:string;nameFr?:string|null;description?:string|null;_count?:{doctors:number}};
export default function AdminSpecialties(){
  useLanguage();
 const qc=useQueryClient(),{showToast}=useToast(),confirmation=useAdminConfirm(),{q,setQ,clear}=useAdminListParams();
 const query=useQuery({queryKey:['admin-specialties'],queryFn:async()=>(await api.get('/admin/specialties')).data.data as Specialty[]});
 const [editing,setEditing]=useState<Specialty|null|undefined>(),[nameAr,setName]=useState(''),[nameFr,setFrench]=useState(''),[description,setDescription]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const rows=(query.data??[]).filter(s=>[s.nameAr,s.nameFr].some(t=>t?.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())));
 function edit(s:Specialty|null){setEditing(s);setName(s?.nameAr??'');setFrench(s?.nameFr??'');setDescription(s?.description??'');setError('');}
 async function save(){if(saving)return;const name=nameAr.trim().replace(/\s+/g,' ');if(name.length<2||name.length>100){setError(t("اسم التخصص من حرفين إلى 100 حرف."));return;}setSaving(true);setError('');try{const body={nameAr:name,nameFr:nameFr.trim(),description:description.trim()};if(editing)await api.patch('/admin/specialties/'+editing.id,body);else await api.post('/admin/specialties',body);showToast(editing?t("تم تعديل التخصص مع حفظ معرفه."):t("تمت الإضافة."),'success');setEditing(undefined);await qc.invalidateQueries({queryKey:['admin-specialties']});}catch(e){setError(apiErrorMessage(e));}finally{setSaving(false);}}
 function remove(s:Specialty){confirmation.ask({title:t("حذف التخصص"),record:s.nameAr,impact:t("يرتبط به {0} طبيب. الحذف نهائي؛ يمنع الخادم حذف التخصص المستخدم.", { "0": s._count?.doctors??0 }),action:async()=>{await api.delete('/admin/specialties/'+s.id);showToast(t("تم حذف التخصص."),'success');await qc.invalidateQueries({queryKey:['admin-specialties']});}});}
 return <div className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-extrabold">{t("إدارة التخصصات")}</h1><Button onClick={()=>edit(null)}>{t("إضافة تخصص")}</Button></header><Input label={t("بحث عن تخصص")} value={q} onChange={e=>setQ(e.target.value)} className="max-w-sm"/><AdminResults total={rows.length} filtered={!!q} onClear={clear}/>{query.isLoading?<Spinner/>:query.isError?<ErrorState message={apiErrorMessage(query.error)} onRetry={()=>void query.refetch()}/>:rows.length?<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map(s=><article key={s.id} className="card space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold"><bdi>{catalogName(s)}</bdi></h2>{s.nameFr&&<p className="text-sm text-slate-600"><bdi>{s.nameFr}</bdi></p>}</div><AdminActions label={t("تخصص ")+catalogName(s)}><Button variant="outline" onClick={()=>edit(s)}>{t("تعديل التخصص")}</Button><Button variant="danger" aria-label={t("حذف تخصص ")+catalogName(s)} disabled={!!s._count?.doctors} onClick={()=>remove(s)}>{t("حذف التخصص")}</Button></AdminActions></div>{s.description&&<p className="text-sm text-slate-600">{s.description}</p>}<p className="text-xs text-slate-600">{t("الأطباء المرتبطون: ")}{s._count?.doctors??'—'}</p></article>)}</div>:<EmptyState title={q?t("لا نتائج مطابقة"):t("لا توجد تخصصات")}/>}
 <Modal open={editing!==undefined} onClose={()=>{if(!saving)setEditing(undefined);}} title={editing?t("تعديل تخصص ")+editing.nameAr:t("إضافة تخصص جديد")} footer={<><Button variant="outline" disabled={saving} onClick={()=>setEditing(undefined)}>{t("إلغاء")}</Button><Button loading={saving} onClick={()=>void save()}>{editing?t("حفظ التعديل"):t("إضافة")}</Button></>}><div className="space-y-3"><Input label={t("اسم التخصص")} value={nameAr} maxLength={100} onChange={e=>setName(e.target.value)}/><Input label={t("الاسم الفرنسي (اختياري)")} value={nameFr} maxLength={100} onChange={e=>setFrench(e.target.value)}/><Input label={t("الوصف (اختياري)")} value={description} maxLength={1000} onChange={e=>setDescription(e.target.value)}/>{error&&<p role="alert" className="text-red-700">{t(error ?? "")}</p>}</div></Modal>{confirmation.dialog}</div>;
}
