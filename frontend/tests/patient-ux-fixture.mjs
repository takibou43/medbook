// Local, disposable UI fixture. No DB, credentials, push, SMS or outbound requests.
// Run with: node tests/patient-ux-fixture.mjs (serve the locally built dist on 4178).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('dist');
const today=new Date(Date.now()+3600000).toISOString().slice(0,10);
const wilayas=[{id:'w1',code:'43',nameAr:'ميلة',cities:[{id:'c1',nameAr:'ميلة',wilayaId:'w1'},{id:'c2',nameAr:'فرجيوة',wilayaId:'w1'}]}, {id:'w2',code:'16',nameAr:'الجزائر',cities:[{id:'c3',nameAr:'الجزائر الوسطى',wilayaId:'w2'}]}];
const specialty={id:'s1',nameAr:'طب الأطفال'};
const clinic={id:'clinic1',nameAr:'عيادة الاختبار المعزول',address:'عنوان وهمي للاختبار',phone:'0550000000',city:wilayas[0].cities[0],wilaya:wilayas[0],_count:{doctors:1}};
const doctor={id:'doctor1',firstName:'طبيب',lastName:'اختبار',specialtyId:'s1',specialty,clinic,wilaya:wilayas[0],city:wilayas[0].cities[0],avgRating:4.7,reviewsCount:12,verificationStatus:'VERIFIED',yearsExperience:5,languages:['العربية'],bio:'بيانات وهمية محلية'};
const member={id:'child1',firstName:'ياسين',lastName:'اختبار',relationship:'CHILD',archivedAt:null};
const self={type:'SELF',name:'سارة اختبار',relationship:null,familyMemberId:null};
const kid={type:'FAMILY_MEMBER',name:'ياسين اختبار',relationship:'CHILD',familyMemberId:member.id};
const user={id:'fixture-user',email:'patient@example.test',role:'PATIENT',phone:'0550000000',isActive:true,patient:{id:'fixture-patient',firstName:'سارة',lastName:'اختبار'},profiles:{patient:true,doctor:{status:'VERIFIED'},canApplyAsDoctor:false}};
let appointments=[{id:'family-upcoming',date:today,startTime:'11:00',endTime:'11:07',type:'FOLLOW_UP',status:'CONFIRMED',doctor,beneficiary:kid,familyMemberId:member.id,createdBy:'DOCTOR'}, {id:'self-upcoming',date:today,startTime:'14:00',endTime:'14:07',type:'IN_PERSON',status:'CONFIRMED',doctor,beneficiary:self}, ...Array.from({length:23},(_,i)=>({id:`past-${i}`,date:'2026-09-10',startTime:'09:00',endTime:'09:07',type:'IN_PERSON',status:'COMPLETED',doctor,beneficiary:i%2?kid:self,familyMemberId:i%2?member.id:null,review:{id:`review-${i}`,rating:4}}))];
const writes=[];
let read=false;
const slots=Array.from({length:128},(_,i)=>`${String(6+Math.floor(i/8)).padStart(2,'0')}:${String(i%8*7).padStart(2,'0')}`);
const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({data}));};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4178'); const route=url.pathname;
  if(route.startsWith('/api/')) {
    let body=''; for await (const chunk of req) body+=chunk;
    const payload=body?JSON.parse(body):{};
    if(req.method!=='GET') {
      if(route==='/api/patient/auth/refresh') return send(res,{accessToken:'isolated-fixture-token'});
      if(route==='/api/booking') {
        assert.equal(payload.doctorId,doctor.id);
        assert.ok(payload.firstName.trim() && payload.lastName.trim());
        assert.ok(!payload.phone || /^0[5-7]\d{8}$/.test(payload.phone));
        if(payload.familyMemberId) assert.equal(payload.familyMemberId,member.id);
        if(payload.exactTime) assert.ok(slots.includes(payload.startTime));
        writes.push({method:req.method,route,payload});
        const result={id:`created-${writes.length}`,date:payload.date||today,startTime:payload.startTime||'06:00',endTime:'06:07',type:'IN_PERSON',status:'CONFIRMED',doctor,beneficiary:payload.familyMemberId?kid:self,familyMemberId:payload.familyMemberId||null};
        appointments.unshift(result);
        fs.writeFileSync('tests/patient-ux-writes.json',JSON.stringify(writes,null,2));
        return send(res,result);
      }
      if(req.method==='DELETE' && route.startsWith('/api/appointments/')) {
        const a=appointments.find(a=>a.id===route.split('/').at(-1)); assert.ok(a);
        a.status='CANCELLED';
      } else if(route==='/api/notifications/read-all') read=true;
      else if(route==='/api/patient/profile') assert.ok(wilayas.flatMap(w=>w.cities).some(c=>c.id===payload.cityId));
      else return send(res,{message:'Fixture blocks unsupported writes'},403);
      writes.push({method:req.method,route,payload}); fs.writeFileSync('tests/patient-ux-writes.json',JSON.stringify(writes,null,2)); return send(res,{});
    }
    if(route==='/api/patient/auth/me') return send(res,user);
    if(route==='/api/wilayas') return send(res,wilayas);
    if(route==='/api/patient/account/appointments') return req.headers.authorization?send(res,appointments):send(res,null,403);
    if(route==='/api/patient/family-members') return send(res,[member]);
    if(route==='/api/patient/profile') return send(res,{cityId:'c1',city:wilayas[0].cities[0]});
    if(route==='/api/notifications') return send(res,[{id:'n1',title:'موعد العودة',message:'موعد اختبار للمستفيد ياسين',appointmentId:'family-upcoming',isRead:read,createdAt:new Date().toISOString()},{id:'foreign',title:'اختبار الصلاحيات',message:'هذا الموعد غير تابع للحساب',appointmentId:'unauthorized',isRead:true}]);
    if(route==='/api/doctors') {const ok=(!url.searchParams.get('wilayaId')||url.searchParams.get('wilayaId')==='w1')&&(!url.searchParams.get('cityId')||url.searchParams.get('cityId')==='c1')&&(!url.searchParams.get('q')||'طبيب اختبار'.includes(url.searchParams.get('q')));return send(res,{items:ok?[doctor]:[],totalPages:1,total:ok?1:0});}
    if(route==='/api/doctors/doctor1') return send(res,doctor);
    if(route==='/api/clinics') {const ok=(!url.searchParams.get('wilayaId')||url.searchParams.get('wilayaId')==='w1')&&(!url.searchParams.get('cityId')||url.searchParams.get('cityId')==='c1');return send(res,{items:ok?[clinic]:[],totalPages:1});}
    if(route==='/api/clinics/clinic1') return send(res,{...clinic,doctors:[doctor]});
    if(route==='/api/booking/next-slot') return send(res,{date:today,startTime:'06:00',endTime:'06:07',slotMinutes:7});
    if(route==='/api/booking/availability') return send(res,url.searchParams.get('date')?{slots}:{days:[{date:today,freeCount:128,firstTime:'06:00'}],slotMinutes:7});
    if(route.startsWith('/api/booking/status/')) {const a=appointments.find(a=>a.id===route.split('/').at(-1));return a?send(res,{id:a.id,date:a.date,startTime:a.startTime,status:a.status,doctor:{firstName:doctor.firstName,lastName:doctor.lastName,specialty:specialty.nameAr,address:clinic.address,phone:clinic.phone},isToday:true,position:3,aheadOfYou:2,estimatedWaitMinutes:14,skipCredits:0}):send(res,null,404);}
    if(route==='/api/public/stats/bookings') return send(res,{displayText:'بيئة اختبار محلية معزولة',displayCount:128});
    if(route==='/api/push/public-key') return send(res,{enabled:false,publicKey:''});
    return send(res,[]);
  }
  const file=path.resolve(root,'.'+decodeURIComponent(route));
  if(file !== root && !file.startsWith(root+path.sep)) {res.writeHead(403);return res.end();}
  const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(root,'index.html');
  const ext=path.extname(target);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[ext]||'application/octet-stream'});fs.createReadStream(target).pipe(res);
}).listen(4178,'127.0.0.1',()=>console.log('Isolated UI fixture: http://127.0.0.1:4178/?switch=1 ; no production access'));
