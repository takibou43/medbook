// Local browser regression: fake camera and mocked APIs only; no production data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
const require=createRequire(import.meta.url);
const qrcode=require('../../frontend-doctor/node_modules/qrcode-generator');
const scanCode='medbook-arrival:v2:doctor:7cc56412-1136-4f7c-a957-a63908efc8bc:'+ '5fe26c57cd8ec5b0a38504ca7901094d';
function qrMatrix(value){const qr=qrcode(0,'M');qr.addData(value);qr.make();return Array.from({length:qr.getModuleCount()},(_,y)=>Array.from({length:qr.getModuleCount()},(_,x)=>qr.isDark(y,x)));}
const matrix=qrMatrix(scanCode);
const bookingMatrix=qrMatrix('https://medbook-alpha.vercel.app/?doctor=7cc56412-1136-4f7c-a957-a63908efc8bc');
const scanRequests=[];
let noAppointment=false;
let bookingWrites=0;
const doctorId='7cc56412-1136-4f7c-a957-a63908efc8bc';
const clinicId='44444444-4444-4444-8444-444444444444';
const clinicCode='medbook-arrival:v2:clinic:'+clinicId+':'+ '86285bbaf6ec32605e2bec0030567109';
const wilayaId='22222222-2222-4222-8222-222222222222';
const city={id:'33333333-3333-4333-8333-333333333333',wilayaId,nameAr:'مدينة اختبار'};
const wilaya={id:wilayaId,nameAr:'ولاية اختبار',cities:[city]};
const doctor={id:doctorId,firstName:'طبيب',lastName:'الاختبار',specialtyId:'specialty',specialty:{id:'specialty',nameAr:'طب عام'},wilaya,city,avgRating:0,reviewsCount:0,yearsExperience:1,languages:[],verificationStatus:'VERIFIED'};
const patientUser={id:'test-user',role:'PATIENT',email:'test@example.invalid',patient:{id:'test-patient',firstName:'اختبار',lastName:'محلي',cityId:city.id,city}};
function mockedData(request){
 const url=new URL(request.url());
 if(url.pathname.endsWith('/patient/auth/me'))return patientUser;
 if(url.pathname.endsWith('/patient/auth/register'))return {user:patientUser,accessToken:'synthetic-registered-session'};
 if(url.pathname.endsWith('/doctors/'+doctorId))return doctor;
 if(url.pathname.endsWith('/clinics/'+clinicId))return {id:clinicId,nameAr:'عيادة الاختبار',address:'عنوان اختبار',wilaya,city,doctors:[doctor]};
 if(url.pathname.endsWith('/doctors'))return {items:[doctor],totalPages:1,total:1,page:1};
 if(url.pathname.endsWith('/booking/next-slot'))return {date:'2030-01-01',startTime:'10:00',endTime:'10:15',slotMinutes:15};
 if(url.pathname.endsWith('/wilayas'))return [wilaya];
 if(url.pathname.endsWith('/cities'))return [city];
 return [];
}
async function mockApi(route){
 const request=route.request();const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
 if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
 if(new URL(request.url()).pathname==='/api/booking'&&request.method()==='POST')bookingWrites++;
 if(request.url().endsWith('/appointments/scan-arrival')){scanRequests.push(request.postDataJSON());await new Promise(resolve=>setTimeout(resolve,800));return route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({success:true,data:noAppointment?{bookingRequired:true,bookingPath:request.postDataJSON().code.includes(':clinic:')?'/clinics/'+clinicId:'/?doctor='+doctorId+'&intent=booking'}:{appointmentId:doctorId,arrivedAt:new Date().toISOString(),alreadyArrived:false}})});}
 return route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({success:true,data:mockedData(request)})});
}
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const policy=config.headers.find(r=>r.source==='/(.*)').headers.find(h=>h.key==='Permissions-Policy').value;
const server=await preview({root,preview:{host:'127.0.0.1',port:0,headers:{'Permissions-Policy':policy}}});
const base='http://127.0.0.1:'+server.httpServer.address().port;
console.log('Preview ready',base);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
console.log('Browser ready');
try {
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:320,height:740}});
 await context.addInitScript(()=>{
  localStorage.setItem('medbook_access_token','synthetic-camera-test');
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.testTracks=[];
  navigator.mediaDevices.getUserMedia=async constraints=>{
   const permitted=await original(constraints); permitted.getTracks().forEach(t=>t.stop());
   // A deterministic canvas video avoids platform-specific fake-device frame delivery.
   const canvas=document.createElement('canvas'); canvas.width=640;canvas.height=480;
   const draw=()=>{const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,480);if(window.testQR){ctx.fillStyle='black';const cell=Math.min(8,Math.floor(400/window.testQR.length));const left=Math.floor((640-cell*window.testQR.length)/2),top=Math.floor((480-cell*window.testQR.length)/2);window.testQR.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)ctx.fillRect(left+x*cell,top+y*cell,cell,cell);}));}};draw();
   const stream=canvas.captureStream(15);const timer=setInterval(draw,50);
   for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}
   window.testTracks.push(...stream.getTracks());return stream;
  };
 });
 await context.route('**/api/**',mockApi);
 const page=await context.newPage();
 page.on("pageerror", error=>console.log("BROWSER ERROR", error.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 console.log('Home ready');
 assert.equal(await page.evaluate(()=>document.querySelector('header').scrollWidth<=window.innerWidth),true,'home header fits a 320px screen');
 await page.getByRole('link',{name:'تسجيل الوصول بالمسح',exact:true}).click();
 console.log('Scanner opened');
 try {await page.waitForFunction(()=>{const video=document.querySelector('video');return Boolean(video?.srcObject?.active)&&video.readyState>=2;},null,{timeout:30000});} catch(error) {console.log(await page.locator('body').innerText()); console.log(await page.evaluate(()=>({tracks:window.testTracks?.map(t=>({state:t.readyState})),policy:document.featurePolicy.allowsFeature('camera'),video:[...document.querySelectorAll('video')].map(v=>({active:v.srcObject?.active,ready:v.readyState,paused:v.paused,width:v.videoWidth,connected:v.isConnected})),allVideos:document.querySelectorAll('video').length})));throw error;}
 assert.equal(await page.evaluate(()=>document.featurePolicy.allowsFeature('camera')),true);
 await page.getByRole('button',{name:'إغلاق الكاميرا',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.testTracks.length>0&&window.testTracks.every(t=>t.readyState==='ended')),true);
 console.log('PASS home camera icon opens the scanner and fake camera; closing stops all camera tracks');
 await page.getByRole('button',{name:'📷 فتح كاميرا المسح',exact:true}).click();
 await page.evaluate(matrix=>{window.testQR=matrix;},matrix);
 await page.getByRole('status').filter({hasText:'تم تسجيل وصولك بنجاح'}).waitFor({timeout:30000});
 assert.deepEqual(scanRequests,[{code:scanCode}]);
 console.log('PASS real QR decoding sends exactly one arrival request and shows server-confirmed success');
 await page.evaluate(matrix=>{window.testQR=matrix;},bookingMatrix);
 await page.getByRole('button',{name:'📷 فتح كاميرا المسح',exact:true}).click();
 await page.getByRole('status').filter({hasText:'كود الحجز لا يسجّل الحضور'}).waitFor({timeout:30000});
 assert.deepEqual(scanRequests,[{code:scanCode}]);
 console.log('PASS legacy public booking QR cannot record attendance');
 noAppointment=true;
 await page.evaluate(matrix=>{window.testQR=matrix;},matrix);
 await page.getByRole('button',{name:'📷 فتح كاميرا المسح',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('doctor')===doctorId&&url.searchParams.get('intent')==='booking');
 await page.getByRole('button',{name:/أفضّل اختيار يوم أو وقت آخر/}).waitFor();
 assert.equal(bookingWrites,0);
 console.log('PASS no appointment opens the same doctor with nearest slot or optional date/time, without creating a booking');
 const fresh=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:740}});
 await fresh.route('**/api/**',mockApi);
 const registration=await fresh.newPage();
 await registration.goto(base+'/account/arrival?code='+encodeURIComponent(clinicCode),{waitUntil:'domcontentloaded'});
 await registration.waitForURL(url=>url.pathname==='/account/login'&&url.searchParams.get('mode')==='register');
 const preserved=new URL(registration.url()).searchParams.get('redirect');
 assert.equal(new URL(preserved,base).searchParams.get('code'),clinicCode);
 await registration.getByLabel('الاسم واللقب',{exact:true}).fill('اختبار محلي');
 await registration.getByLabel('البريد الإلكتروني',{exact:true}).fill('synthetic@example.invalid');
 await registration.locator('input[name="password"]').fill('Synthetic-test-only-123');
 await registration.locator('#patient-wilaya').selectOption(wilayaId);
 await registration.locator('#patient-city').selectOption(city.id);
 await registration.getByRole('button',{name:'إنشاء الحساب',exact:true}).click();
 await registration.waitForURL(url=>url.pathname==='/clinics/'+clinicId);
 await registration.getByRole('link',{name:'حجز مع هذا الطبيب',exact:true}).click();
 await registration.waitForURL(url=>url.searchParams.get('doctor')===doctorId&&url.searchParams.get('intent')==='booking');
 await registration.getByRole('button',{name:/أفضّل اختيار يوم أو وقت آخر/}).waitFor();
 assert.equal(bookingWrites,0);
 await fresh.close();
 console.log('PASS native clinic QR requires registration, shows clinic doctors, then opens chosen doctor booking after synthetic sign-up');
 const blocked=await context.newPage();
 await blocked.route('**/account/arrival',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'permissions-policy':'camera=(), microphone=()'}});});
 await blocked.goto(base+'/account/arrival',{waitUntil:'domcontentloaded'});
 await blocked.getByRole('status').filter({hasText:'السماح بالكاميرا مطلوب'}).waitFor({timeout:30000});
 console.log('PASS blocked camera policy reproduces the failure with a specific permission message');
 await context.close();
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
