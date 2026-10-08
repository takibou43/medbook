const http = require('http');
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222', U='33333333-3333-4333-8333-333333333333', AP='44444444-4444-4444-8444-444444444444';
const doctors=[{id:A,firstName:'أحمد',lastName:'بن علي',specialty:{nameAr:'طب القلب'},user:{email:'ahmed@example.test',isActive:true},wilaya:{nameAr:'ميلة'},city:{nameAr:'ميلة'},verificationStatus:'VERIFIED',subscriptionStatus:'ACTIVE'}, {id:B,firstName:'سارة',lastName:'Martin',specialty:{nameAr:'طب الأطفال'},user:{email:'sara@example.test',isActive:true},wilaya:{nameAr:'ميلة'},city:{nameAr:'ميلة'},verificationStatus:'PENDING',subscriptionStatus:'UNPAID'}];
const appointments=[{id:AP,date:'2026-10-08T00:00:00.000Z',startTime:'14:30',status:'CONFIRMED',doctor:doctors[0],patient:{firstName:'صاحب',lastName:'الحساب'},familyMemberId:'55555555-5555-4555-8555-555555555555',familyMember:{firstName:'ليلى',lastName:'بن علي'}}];
const users=[{id:U,email:'parent@example.test',phone:'0550000000',role:'PATIENT',isActive:true,patient:{firstName:'صاحب',lastName:'الحساب',blocks:[]}}];
const user={id:'admin-demo',role:'ADMIN',email:'admin@example.test',isActive:true,profiles:{patient:false,doctor:false},clinicManagement:null};
const page=(items,url)=>{const id=url.searchParams.get('id'),q=url.searchParams.get('q');let rows=id?items.filter(x=>x.id===id):items;if(q) rows=rows.filter(x=>JSON.stringify(x).includes(q)); return {items:rows,total:rows.length,page:Number(url.searchParams.get('page')||1),totalPages:3,pageSize:20};};
const threads=new Map([[A,[{id:'message-a',content:'مرحبًا، أحتاج مراجعة بيانات العيادة.',senderRole:'DOCTOR',readAt:'2026-10-08T12:00:00Z',createdAt:'2026-10-08T12:00:00Z'}]],[B,[]]]);
function fixture(url,method,body){
 const p=url.pathname.replace(/^\/api/,'');
 if(p==='/auth/me')return user;
 if(p==='/auth/login')return {user,accessToken:'local-fixture-only'};
 if(p==='/auth/profiles')return {patient:null,doctor:null};
 if(p==='/admin/doctors')return page(doctors,url);
 if(p==='/admin/users')return page(users,url);
 if(p==='/admin/appointments')return page(appointments,url);
 if(p==='/admin/messages/conversations')return {items:doctors.filter(d=>!url.searchParams.get('q')||[d.firstName,d.lastName].join(' ').includes(url.searchParams.get('q'))).map(d=>({doctorId:d.id,doctorName:[d.firstName,d.lastName].join(' '),specialty:d.specialty.nameAr,unread:0,lastMessageAt:null,lastMessagePreview:null})),total:2};
 if(p.endsWith('/unread-count'))return {unread:0,latest:null};
 const match=p.match(/^\/admin\/messages\/conversations\/([^/]+)\/messages$/);
 if(match){const id=match[1]; if(method==='POST'){const old=threads.get(id)||[]; const existing=old.find(x=>x.clientId===body.clientId); const message=existing||{id:'sent-'+body.clientId,clientId:body.clientId,content:body.content,senderRole:'ADMIN',readAt:null,createdAt:new Date().toISOString()};if(!existing)threads.set(id,[...old,message]);return message;}return {items:threads.get(id)||[],hasMore:false};}
 if(p.endsWith('/read'))return {};
 if(p==='/admin/stats')return {patients:1,doctors:2,clinics:1,appointments:1,todayAppointments:1,pendingVerification:1,completed:0,cancelled:0};
 if(p==='/admin/stats/series')return {items:[],series:[],total:0};
 if(p==='/admin/system-status')return {checkedAt:new Date().toISOString(),checks:[]};
 if(p==='/admin/activity')return [{id:'activity-appointment',type:'APPOINTMENT_CONFIRMED',title:'تأكيد موعد',detail:'د. أحمد بن علي — ٨ أكتوبر ٢٠٢٦ 14:30 (تاريخ الموعد)',at:'2026-10-08T12:00:00Z',link:'/admin/appointments?id='+AP}];
 if(p==='/admin/search')return {doctors,patients:[{id:'patient-demo',userId:U,firstName:'صاحب',lastName:'الحساب',phone:'0550000000'}],appointments,messages:[]};
 if(p==='/admin/specialties')return [{id:'specialty-a',nameAr:'طب القلب',description:'أمراض القلب والأوعية'},{id:'specialty-b',nameAr:'طب الأطفال'}];
 if(p==='/admin/wilayas')return [{id:'wilaya-a',code:'43',nameAr:'ميلة',cities:[{id:'city-a',nameAr:'ميلة'},{id:'city-b',nameAr:'فرجيوة'}]}];
 if(p==='/admin/reviews')return [{id:'review-a',patient:{firstName:'ليلى',lastName:'بن علي'},doctor:doctors[0],rating:4,comment:'تنظيم جيد'}];
 if(p==='/admin/referrals'||p==='/admin/patient-blocks')return {items:[],total:0,page:1,totalPages:1};
 if(p==='/clinics/admin/list')return [];
 if(p==='/clinics/admin/transfers')return [];
 if(p.includes('notifications'))return p.endsWith('unread-count')?{count:0}:[];
 return null;
}
if(require.main===module)http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',req.headers.origin||'*');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 let raw='';for await(const c of req)raw+=c;
 let data;try{data=fixture(new URL(req.url,'http://127.0.0.1'),req.method,raw?JSON.parse(raw):{});}catch{res.writeHead(400);return res.end('{}');}
 res.setHeader('Content-Type','application/json');
 if(data===null){res.writeHead(404);return res.end(JSON.stringify({success:false,message:'المسار غير متاح في المعاينة'}));}
 res.end(JSON.stringify({success:true,data}));
}).listen(4181,'127.0.0.1',()=>console.log('Isolated fixture API http://127.0.0.1:4181/api'));
module.exports={fixture,A,B,U,AP};
