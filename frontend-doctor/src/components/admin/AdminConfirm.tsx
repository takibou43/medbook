import { t } from "../../i18n/locale.ts";
import { useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { apiErrorMessage } from '../../lib/api';
type Action={title:string;record:string;impact:string;confirmText?:string;reasonRequired?:boolean;action:(reason:string)=>Promise<void>};
export function useAdminConfirm(){
 const [request,setRequest]=useState<Action|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 function ask(next:Action){setReason('');setError('');setRequest(next);}
 async function confirm(){if(!request||lock.current)return;if(request.reasonRequired&&reason.trim().length<3){setError(t("أدخل سببًا واضحًا من ثلاثة أحرف على الأقل."));return;}lock.current=true;setBusy(true);setError('');try{await request.action(reason.trim());setRequest(null);}catch(e){setError(apiErrorMessage(e));}finally{lock.current=false;setBusy(false);}}
 const dialog=<Modal open={!!request} onClose={()=>{if(!lock.current)setRequest(null);}} title={request?.title} footer={<><Button variant="outline" disabled={busy} onClick={()=>setRequest(null)}>{t("إلغاء")}</Button><Button variant="danger" loading={busy} onClick={()=>void confirm()}>{request?.confirmText??t("تأكيد الإجراء")}</Button></>}><div className="space-y-4"><p className="break-words font-bold"><bdi>{request?.record}</bdi></p><p className="text-sm text-slate-600">{request?.impact}</p>{request?.reasonRequired&&<Input label={t("سبب الإجراء")} value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} disabled={busy}/>} {error&&<p role="alert" className="text-red-700">{t(error ?? "")}</p>}</div></Modal>;
 return {ask,dialog};
}
