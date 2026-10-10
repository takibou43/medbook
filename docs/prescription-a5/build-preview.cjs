const fs = require('fs'), path = require('path');
const root = process.cwd();
const esbuild = require(path.join(root, 'frontend-doctor/node_modules/esbuild'));
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PrescriptionPreview} from './src/components/prescription/PrescriptionPrint';
function Demo(){const [long,setLong]=useState(false);const [fr,setFr]=useState(false);const [open,setOpen]=useState(true);
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="592" height="840"><rect width="592" height="840" fill="white"/><text x="296" y="65" text-anchor="middle" font-size="26" fill="#15655d">Cabinet de démonstration</text><path d="M40 110H552 M40 750H552" stroke="#15655d" stroke-width="3"/><text x="296" y="790" text-anchor="middle" font-size="16">Modèle vierge de démonstration</text></svg>';
const data={language:fr?'fr':'ar',doctor:null,patientName:'مريض تجريبي — Patient Démonstration',day:'2026-10-10',notes:'بيانات اصطناعية فقط',template:{image:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),top:35,bottom:25,side:12},medications:Array.from({length:long?14:2},(_,i)=>({id:String(i),name:'Médicament de démonstration '+(i+1),dose:'تعليمات تجريبية',frequency:'Texte saisi par le médecin',duration:'نص تجريبي',instructions:'Aucune recommandation médicale'}))};
return <><button onClick={()=>{setLong(!long);setOpen(true)}}>وصفة طويلة / قصيرة</button><button onClick={()=>{setFr(!fr);setOpen(true)}}>AR / FR</button><button onClick={()=>setOpen(true)}>معاينة</button><PrescriptionPreview open={open} data={data} onClose={()=>setOpen(false)}/></>};createRoot(document.getElementById('root')).render(<Demo/>);`;
(async()=>{
const out=await esbuild.build({stdin:{contents:entry,resolveDir:path.join(root,'frontend-doctor'),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const assets=path.join(root,'frontend-doctor/dist/assets');
const css=fs.readFileSync(path.join(assets,fs.readdirSync(assets).find(x=>x.endsWith('.css'))),'utf8');
fs.writeFileSync(path.join(__dirname,'preview.html'),'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A5 template — synthetic data</title><style>'+css+'</style><body><div id="root"></div><script>'+out.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script></body></html>');
})();
