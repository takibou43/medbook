import { api } from '../../lib/api';
type DoctorOption={id:string;firstName:string;lastName:string};
// Fetch every paginated name; searching appointments/comments must not erase
// a selected doctor or silently limit the filter to the first fifty doctors.
export async function loadAdminDoctorOptions(signal:AbortSignal){
 const items:DoctorOption[]=[];
 for(let page=1;page<=1000;page++){
  const data=(await api.get('/admin/doctors',{signal,params:{page,pageSize:50}})).data.data;
  items.push(...data.items.map((d:DoctorOption)=>({id:d.id,firstName:d.firstName,lastName:d.lastName})));
  if(page>=data.totalPages||!data.items.length)break;
 }
 return {items};
}
