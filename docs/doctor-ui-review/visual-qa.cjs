// Local-only UI checks. Every API request is intercepted; no production/DB/SMS access.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/benz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'../../frontend-doctor/dist');
const day=new Date(Date.now()+3600000).toISOString().slice(0,10);
const prev=new Date(new Date(day+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
const next=new Date(new Date(day+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10);
const doctor={id:'demo-doctor',firstName:'أمين',lastName:'بن سالم',verificationStatus:'VERIFIED',subscriptionStatus:'ACTIVE',subscriptionExpiresAt:null,slotDurationMin:15,specialty:{nameAr:'طب الأسنان',nameFr:'Dentiste'},clinic:{id:'demo-clinic',nameAr:'عيادة تجريبية'},avgRating:4.8,reviewsCount:8};
const user={id:'demo-user',email:'demo@example.invalid',role:'DOCTOR',doctor};
const patient={id:'demo-patient',firstName:'سارة',lastName:'بن علي',user:{phone:'0550000000'}};
const appointments=Array.from({length:27},(_,i)=>({id:'demo-'+i,patientId:i<25?'p'+i:null,familyMemberId:null,patient:i<25?{...patient,firstName:i===1?'Yasmine Martin':i===2?'ياسين':patient.firstName}:null,guestFirstName:i===25?'Ali':'Sara',guestLastName:'Demo',guestPhone:'0550000000',date:(i===3?prev:i>10?next:day)+'T00:00:00.000Z',startTime:String(9+Math.floor(i/6)).padStart(2,'0')+':'+String((i%6)*10).padStart(2,'0'),endTime:'13:00',status:i===0?'IN_PROGRESS':i===3||i===4?'NO_SHOW':i===2?'LATE':i===5?'PENDING':i===6?'RESCHEDULE_REQUIRED':'CONFIRMED',patientNoShowCount:i===2?2:0,skipCredits:0,doctor}));
let schedule=[{dayOfWeek:0,startTime:'08:00',endTime:'12:00'},{dayOfWeek:0,startTime:'13:00',endTime:'17:00'},{dayOfWeek:1,startTime:'08:00',endTime:'12:00'}];
let requests=[],errors=[],apiMode='normal';
const server=http.createServer((req,res)=>{let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(5193,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:"chrome"});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.addInitScript(()=>localStorage.setItem('medbook_doctor_access_token','local-demo-only'));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(p.includes('/api/')){
   if(p.endsWith('/appointments') && apiMode==='error')return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:5193','Access-Control-Allow-Credentials':'true'},body:JSON.stringify({message:'تعذر تحميل المواعيد التجريبية'})});
   requests.push({path:p,method:req.method()});let data;
   if(p.endsWith('/auth/me'))data=user;
   else if(p.endsWith('/appointments/queue'))data={date:day,current:appointments[0],waiting:appointments.filter(a=>a.date.startsWith(day)&&a.status==='CONFIRMED'),late:[appointments[2]],ordered:appointments.filter(a=>a.date.startsWith(day)&&['CONFIRMED','LATE'].includes(a.status)),todaySummary:{total:11,completed:3,noShow:1,cancelled:0,pending:1,rescheduleRequired:1},estimatedDurationMinutes:15};
   else if(p.endsWith('/doctor/dashboard'))data={todayAppointments:11,totalPatients:27,completedAppointments:48,cancelledAppointments:2,monthlyAppointments:67,avgRating:4.8,reviewsCount:8,noShowRate:4,estimatedRevenueToday:6000,estimatedRevenueMonth:42000,verificationStatus:'VERIFIED',rescheduleRequired:1};
   else if(p.endsWith('/doctor/patients'))data={items:appointments.map(a=>({key:a.id,patientId:a.patientId,familyMemberId:null,isGuest:!a.patientId,firstName:a.patient?.firstName??a.guestFirstName,lastName:a.patient?.lastName??a.guestLastName,phone:'0550000000',totalAppointments:1,lastCompletedVisit:null,nextAppointment:{date:next,startTime:'09:00'},lastAppointmentId:a.patientId?a.id:null})),total:27,page:1,totalPages:2};
   else if(p.endsWith('/doctor/schedule')){if(req.method()==='PUT')schedule=req.postDataJSON().blocks;data=schedule;}
   else if(p.endsWith('/doctor/profile')){Object.assign(doctor,req.postDataJSON());data=doctor;}
   else if(p.endsWith('/appointments')){data=apiMode==='empty'?[]:appointments.filter(a=>(!url.searchParams.get('status')||a.status===url.searchParams.get('status'))&&(!url.searchParams.get('from')||a.date.slice(0,10)>=url.searchParams.get('from'))&&(!url.searchParams.get('to')||a.date.slice(0,10)<=url.searchParams.get('to')));}
   else if(/\/appointments\/demo-/.test(p)){const a=appointments.find(a=>p.endsWith('/'+a.id));if(a&&req.method()==='PATCH'){await new Promise(r=>setTimeout(r,300));a.status=req.postDataJSON().status;}data=a;}
   else if(p.endsWith('/doctor/referrals/me'))data={code:'DEMO',referrals:[],rewardDays:30,totals:{rewardedDays:0,clinicDiscountDays:0}};
   else if(p.includes('/unread'))data={unread:0};else data=[];
   return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:5193','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'},body:JSON.stringify({success:true,data})});
  }
  if(url.hostname==='127.0.0.1'&&url.port==='5193')return route.continue();
  return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const checks=[];
 for(const [label,width,height] of [['desktop',1440,1000],['tablet',820,1100],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  for(const [name,url,ready] of [['today','/','إدارة طابور اليوم'],['appointments','/appointments?tab=list','إدارة المواعيد'],['patients','/patients','سجل مستفيد'],['schedule','/schedule','الجدول الأسبوعي']]){
   await page.goto('http://127.0.0.1:5193'+url);await page.getByText(ready,{exact:false}).first().waitFor().catch(async e=>{await page.screenshot({path:path.join(__dirname,'debug.png'),fullPage:true});console.log({url:page.url(),body:await page.locator('body').innerText(),requests,errors});throw e;});await page.waitForTimeout(250);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' '+name+' overflow');
   await page.screenshot({path:path.join(__dirname,label+'-'+name+'.png'),fullPage:true});checks.push(label+' '+name+' rendered without horizontal overflow');
  }
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:5193/appointments?tab=list');await page.getByRole('heading',{name:'إدارة المواعيد'}).waitFor();await page.getByText('27 نتيجة',{exact:false}).first().waitFor();
 assert.equal(await page.getByRole('button',{name:'حضر متأخرًا',exact:true}).filter({visible:true}).count(),1);
 await page.getByRole('button',{name:'السابقة',exact:true}).click();assert.equal(await page.getByRole('button',{name:'حضر متأخرًا',exact:true}).filter({visible:true}).count(),1);checks.push('only today NO_SHOW has late-arrival action');
 await page.getByRole('button',{name:'الكل',exact:true}).first().click();await page.getByLabel('التالي',{exact:true}).click();assert.match(page.url(),/page=2/);await page.getByLabel('بحث في المواعيد').fill('Yasmine');await page.waitForTimeout(450);assert.doesNotMatch(page.url(),/page=2/);checks.push('search resets page and persists in URL');
 await page.goto('http://127.0.0.1:5193/schedule');await page.getByText('الجدول الأسبوعي',{exact:true}).waitFor();
 await page.getByLabel('الأحد بداية الفترة',{exact:true}).first().fill('14:00');assert.equal(await page.getByRole('button',{name:'حفظ الجدول الأسبوعي'}).isDisabled(),true);assert.equal(await page.getByText('تعديلات لم تُحفظ بعد',{exact:false}).count(),1);checks.push('invalid weekly interval blocks save and marks unsaved draft');
 await page.getByLabel('الأحد بداية الفترة',{exact:true}).first().fill('08:00');await page.getByText('نسخ أوقات يوم إلى أيام أخرى',{exact:true}).click();await page.getByLabel('الثلاثاء',{exact:true}).check();await page.getByRole('button',{name:'نسخ إلى المسودة'}).click();assert.equal(await page.getByLabel('الثلاثاء بداية الفترة',{exact:true}).count(),2);await page.getByRole('button',{name:'حفظ الجدول الأسبوعي'}).click();await page.getByText('الجدول مطابق لآخر نسخة محفوظة',{exact:false}).waitFor();checks.push('copy preserves multiple periods and save confirms draft');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName!=='BODY'),true);checks.push('keyboard focus reaches interactive control');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'المزيد',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#main-content').getAttribute('inert'),'');await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'المزيد',exact:true}).getAttribute('aria-expanded'),'false');checks.push('mobile menu opens with keyboard and closes with Escape');
 await page.getByRole('navigation',{name:'التنقل اليومي'}).getByRole('link',{name:'المواعيد',exact:true}).click();assert.equal(await page.evaluate(()=>scrollY),0);checks.push('new section starts at top');
 await page.goto('http://127.0.0.1:5193/appointments?tab=list&q=Yasmine');await page.getByText('1 نتيجة',{exact:false}).first().waitFor();await page.evaluate(()=>scrollTo({top:200,behavior:"instant"}));const before=await page.evaluate(()=>scrollY);
 await page.getByRole('navigation',{name:'التنقل اليومي'}).getByRole('link',{name:'المرضى',exact:true}).click();await page.getByRole('heading',{name:'المرضى',exact:true}).waitFor();await page.goBack();await page.getByText('1 نتيجة',{exact:false}).first().waitFor();assert.equal(await page.getByLabel('بحث في المواعيد').inputValue(),'Yasmine');await page.waitForTimeout(200);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<5);checks.push('back restores filters and list scroll position');
 await page.goto('http://127.0.0.1:5193/appointments?tab=list');await page.getByText('27 نتيجة',{exact:false}).first().waitFor();await page.getByRole('button',{name:'تأكيد الموعد',exact:true}).filter({visible:true}).dblclick();await page.waitForTimeout(650);assert.equal(requests.filter(r=>r.method==='PATCH'&&r.path.endsWith('/appointments/demo-5')).length,1);checks.push('double click sends only one status mutation');
 apiMode='empty';await page.reload();await page.getByText('لا توجد مواعيد',{exact:true}).waitFor();await page.screenshot({path:path.join(__dirname,'mobile-empty.png'),fullPage:true});checks.push('empty list state renders');
 apiMode='error';await page.reload();await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).waitFor();await page.screenshot({path:path.join(__dirname,'mobile-error.png'),fullPage:true});checks.push('API error provides retry');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(__dirname,'visual-results.json'),JSON.stringify({checks,errors,requests:requests.length,fixture:'fictional data; all API intercepted'},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
