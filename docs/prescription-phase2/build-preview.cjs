const fs=require('fs'), path=require('path');
const root=process.cwd(), deps=path.join(root,'frontend-doctor/node_modules');
const esbuild=require(path.join(deps,'esbuild'));
const entry=String.raw`import React from 'react'; import {createRoot} from 'react-dom/client';
import {setLanguage} from './src/i18n/locale';
import {PrescriptionCard} from './src/components/prescription/PrescriptionCard';
import {emptyDraft,prescriptionPatientFrom,storeDraft} from './src/lib/prescription';
const old={id:'demo-old',patientId:'demo-p',date:'2026-10-10',startTime:'15:26',status:'IN_PROGRESS',patient:{firstName:'مريض',lastName:'تجريبي'}};
const next={...old,id:'demo-new',startTime:'15:52'};
const draft=emptyDraft('review',prescriptionPatientFrom(old),'current');draft.medications=Array.from({length:8},(_,i)=>({id:'med-'+i,name:'Médicament de démonstration avec un nom très long '+(i+1),dose:'نص الجرعة — 1 unité',frequency:'Selon les instructions du médecin',duration:'Durée saisie par le médecin',instructions:'تعليمات تجريبية طويلة باللغة العربية والفرنسية. Instructions de démonstration uniquement.\nDeuxième ligne conservée.'}));draft.notes='ملاحظات اصطناعية لا تمثل وصفة طبية.\n'+('Remarques longues pour vérifier le retour à la ligne. ملاحظات طويلة لاختبار التفاف النص. '.repeat(20));draft.professional={fr:{doctorName:'Médecin Démonstration',clinicName:'Cabinet de démonstration',address:'Adresse de démonstration'},ar:{doctorName:'طبيب تجريبي',clinicName:'عيادة تجريبية',address:'عنوان تجريبي'}};storeDraft(draft);
createRoot(document.getElementById('root')).render(<><button className="btn-outline mb-3" onClick={()=>setLanguage('fr')}>واجهة فرنسية</button><button className="btn-outline mb-3" onClick={()=>setLanguage('ar')}>واجهة عربية</button><PrescriptionCard current={next} appointments={[old,next]} loading={false} error={false}/></>);`;
(async()=>{
const result=await esbuild.build({stdin:{contents:entry,resolveDir:path.join(root,'frontend-doctor'),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-auth',setup(b){b.onResolve({filter:/AuthContext$/},()=>({path:'offline-auth',namespace:'review'}));b.onLoad({filter:/.*/,namespace:'review'},()=>({contents:'export const useAuth=()=>({user:{id:"review",doctor:null}});',loader:'js'}));}}]});
const css=fs.readFileSync(path.join(root,'frontend-doctor/dist/assets',fs.readdirSync(path.join(root,'frontend-doctor/dist/assets')).find(x=>x.endsWith('.css'))),'utf8');
fs.writeFileSync('docs/prescription-phase2/preview.html','<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة المرحلة الثانية</title><style>'+css+'</style><body class="bg-slate-100"><main class="mx-auto max-w-3xl p-4"><p class="mb-4">معاينة محلية ببيانات اصطناعية. اختر لغة الوصفة وافتح المعاينة. أسماء وتعليمات اصطناعية طويلة لاختبار العرض فقط.</p><div id="root"></div></main><script>'+result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script></body></html>');
})();

