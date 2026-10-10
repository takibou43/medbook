const fs=require('fs'), path=require('path');
const root=process.cwd(), deps=path.join(root,'frontend-doctor/node_modules');
const esbuild=require(path.join(deps,'esbuild'));
const entry=`import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrescriptionCard} from './src/components/prescription/PrescriptionCard';
import {emptyDraft,prescriptionPatientFrom,storeDraft} from './src/lib/prescription';
const old={id:'demo-old',patientId:'demo-p',date:'2026-10-10',startTime:'15:26',status:'IN_PROGRESS',patient:{firstName:'مريض',lastName:'تجريبي'}};
const next={...old,id:'demo-new',startTime:'15:52'};
const draft=emptyDraft('review',prescriptionPatientFrom(old),'current');draft.medications[0].name='دواء تجريبي';storeDraft(draft);
createRoot(document.getElementById('root')).render(<PrescriptionCard current={next} appointments={[old,next]} loading={false} error={false}/>);`;
(async()=>{
const result=await esbuild.build({stdin:{contents:entry,resolveDir:path.join(root,'frontend-doctor'),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-auth',setup(b){b.onResolve({filter:/AuthContext$/},()=>({path:'offline-auth',namespace:'review'}));b.onLoad({filter:/.*/,namespace:'review'},()=>({contents:'export const useAuth=()=>({user:{id:"review",doctor:null}});',loader:'js'}));}}]});
const css=fs.readFileSync(path.join(root,'frontend-doctor/dist/assets',fs.readdirSync(path.join(root,'frontend-doctor/dist/assets')).find(x=>x.endsWith('.css'))),'utf8');
fs.writeFileSync('docs/prescription-phase1/preview.html','<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة المرحلة الأولى</title><style>'+css+'</style><body class="bg-slate-100"><main class="mx-auto max-w-3xl p-4"><p class="mb-4">معاينة محلية ببيانات اصطناعية. اضغط معاينة وطباعة لإظهار أخطاء الحقول، أو اختر تعليمات حرة وأكملها.</p><div id="root"></div></main><script>'+result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script></body></html>');
})();
