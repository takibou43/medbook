const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {fixture,A,B,U,AP}=require('../admin-phase1/preview/fixture-api.cjs');
const base='http://127.0.0.1:5190',out=path.resolve('docs/admin-phase2'),results=[],errors=[],writes=[];
async function main(){
 fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/benz/.cache/puppeteer/chrome/win64-154.0.8037.57/chrome-win64/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1280,height:900},locale:'ar-DZ'});
 await context.addInitScript(()=>localStorage.setItem('medbook_doctor_access_token','local-fixture-only'));
 let failed='',empty='',slow=false;
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.startsWith('/api/')){
   if(req.method()!=='GET')writes.push({method:req.method(),path:url.pathname});
   if(url.pathname===failed)return route.fulfill({status:500,json:{success:false,message:'فشل اختبار معزول'}});
   if(slow&&url.pathname==='/api/admin/users'&&url.searchParams.get('q')==='parent')await new Promise(r=>setTimeout(r,1200));
   let data=fixture(url,req.method(),req.postData()?req.postDataJSON():{});
   if(url.pathname===empty)data={items:[],total:0,page:1,totalPages:1};
   return route.fulfill({status:data===null?404:200,json:{success:data!==null,data,message:'المسار التجريبي'}}).catch(()=>{});
  }
  if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();
  return route.abort();
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 const test=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.message});}console.log(name,results.at(-1).status,results.at(-1).error||'');fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({results,errors},null,2));};
 const goto=async(route)=>{await page.goto(base+route,{waitUntil:'domcontentloaded'});await page.locator('main h1').waitFor();};
 await test('navigation groups, home first, active section and all twelve routes',async()=>{
  await goto('/admin/users');const nav=page.locator('aside nav');assert.equal(await nav.getByRole('link').first().getAttribute('href'),'/admin');assert.equal(await nav.getByRole('link').count(),12);
  for(const text of ['التشغيل والمتابعة','الحسابات والأطباء والعيادات','الكتالوج والإعدادات'])await nav.getByText(text,{exact:true}).waitFor();
  assert.equal(await nav.locator('[aria-current="page"]').getAttribute('href'),'/admin/users');
  for(const route of ['/admin','/admin/appointments','/admin/messages','/admin/users','/admin/patient-blocks','/admin/referrals','/admin/doctors','/admin/clinics','/admin/specialties','/admin/wilayas','/admin/reviews','/admin/account']){await goto(route);assert.equal(await page.locator('main h1:visible').count(),1);}
 });
 await test('URL filters, reload, history and clear retain unrelated parameters',async()=>{
  await goto('/admin/users?q=parent&role=PATIENT&page=2&keep=yes');await page.getByText('parent@example.test',{exact:true}).last().waitFor();await page.reload();assert.equal(await page.getByRole('textbox',{name:'بحث عن مستخدم'}).inputValue(),'parent');
  await page.getByRole('button',{name:'مسح الفلاتر'}).click();await page.waitForTimeout(450);let u=new URL(page.url());assert.equal(u.searchParams.get('keep'),'yes');for(const k of ['q','role','page'])assert.equal(u.searchParams.has(k),false);
  await page.goBack();await page.waitForFunction(()=>document.querySelector('input')?.value==='parent');assert.equal(new URL(page.url()).searchParams.get('q'),'parent');await page.goForward();await page.waitForFunction(()=>document.querySelector('input')?.value==='');assert.equal(new URL(page.url()).searchParams.get('q'),null);
 });
 await test('secondary actions hidden, disclosure Escape and outside dismissal, no write on open',async()=>{
  await goto('/admin/users');const d=page.locator('details:visible').first();await d.locator('summary').waitFor();assert.equal(await d.getByRole('button',{name:'تعطيل',exact:true}).isVisible(),false);let n=writes.length;await d.locator('summary').click();assert.equal(await d.getByRole('button',{name:'تعطيل',exact:true}).isVisible(),true);await d.locator('summary').press('Escape');assert.equal(await d.getAttribute('open'),null);assert.equal(await d.locator('summary').evaluate(el=>el===document.activeElement),true);await d.locator('summary').click();await page.locator('h1').click();assert.equal(await d.getAttribute('open'),null);assert.equal(writes.length,n);
 });
 for(const width of [360,390,768,1280])await test('appointments and accounts fit '+width,async()=>{
  await page.setViewportSize({width,height:844});
  for(const route of ['appointments','users']){await goto('/admin/'+route);await page.locator(width<768?'article':'table:visible').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(width<768){const card=page.locator('article').first();assert.ok((await card.boundingBox()).width<=width-32);if(route==='appointments'){for(const t of ['ليلى بن علي','مؤكد','د. أحمد بن علي','14:30'])await card.getByText(t,{exact:true}).waitFor();assert.equal(await card.getByText('صاحب الحساب',{exact:true}).count(),0);}else{await card.locator('summary').click();for(const button of await card.getByRole('button').all()){const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);}await card.locator('summary').press('Escape');}}
   await page.screenshot({path:path.join(out,'screenshots',`after-${route}-${width}.png`),fullPage:true});
  }
 });
 await test('mobile menu closes with Escape, restores focus and reaches account settings',async()=>{
  await page.setViewportSize({width:360,height:640});await goto('/admin');let button=page.getByRole('button',{name:'فتح القائمة',exact:true});await button.click();const nav=page.getByRole('navigation',{name:'قائمة الأقسام'});await nav.waitFor();assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');await page.keyboard.press('Escape');assert.equal(await nav.count(),0);assert.equal(await button.evaluate(el=>el===document.activeElement),true);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');await button.click();await nav.locator('a[href="/admin/account"]').click();assert.ok(page.url().endsWith('/admin/account'));assert.equal(await nav.count(),0);
 });
 await test('request failure preserves search, retry recovers real results',async()=>{
  await page.setViewportSize({width:1280,height:900});failed='/api/admin/users';await goto('/admin/users?q=parent');await page.getByRole('button',{name:'إعادة المحاولة'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'بحث عن مستخدم'}).inputValue(),'parent');assert.equal(await page.getByText('لا يوجد مستخدمون',{exact:true}).count(),0);failed='';await page.getByRole('button',{name:'إعادة المحاولة'}).click();await page.getByText('parent@example.test',{exact:true}).last().waitFor();
 });
 await test('empty data differs from no matching search',async()=>{
  empty='/api/admin/users';await goto('/admin/users');await page.reload({waitUntil:'domcontentloaded'});await page.getByText('لا يوجد مستخدمون',{exact:true}).waitFor();await page.getByRole('textbox',{name:'بحث عن مستخدم'}).fill('غير مطابق');await page.getByText('لا نتائج مطابقة',{exact:true}).waitFor();empty='';
 });
 await test('delayed old search cannot replace newer result',async()=>{
  await goto('/admin/users');slow=true;const input=page.getByRole('textbox',{name:'بحث عن مستخدم'});await input.fill('parent');await page.waitForTimeout(400);await input.fill('لااسممطابق');await page.getByText('لا نتائج مطابقة',{exact:true}).waitFor();await page.waitForTimeout(1500);assert.equal(await page.getByText('لا نتائج مطابقة',{exact:true}).count(),1);assert.equal(new URL(page.url()).searchParams.get('q'),'لااسممطابق');slow=false;
 });
 await test('dashboard request failure offers retry with stable heading',async()=>{
  failed='/api/admin/stats';await goto('/admin');await page.getByRole('button',{name:'إعادة المحاولة'}).waitFor();assert.equal(await page.locator('main h1:visible').count(),1);failed='';await page.getByRole('button',{name:'إعادة المحاولة'}).click();await page.getByRole('textbox',{name:'البحث العام في الإدارة'}).waitFor();
 });
 await test('message search preserves recipient, drafts remain per doctor',async()=>{
  await goto('/admin/messages?doctor='+A);await page.locator('textarea').waitFor();await page.locator('textarea').fill('مسودة أحمد');const input=page.getByRole('textbox',{name:'بحث عن طبيب في المحادثات'});await input.fill('لااسممطابق');await page.getByText('لا نتائج مطابقة.',{exact:true}).waitFor();await page.getByText('د. أحمد بن علي',{exact:true}).waitFor();await page.getByRole('button',{name:'مسح البحث'}).click();await page.getByRole('button').filter({hasText:'سارة Martin'}).click();assert.equal(await page.locator('textarea').inputValue(),'');await page.locator('textarea').fill('مسودة سارة');await page.getByRole('button').filter({hasText:'أحمد بن علي'}).click();assert.equal(await page.locator('textarea').inputValue(),'مسودة أحمد');
 });
 await test('list errors offer retry across catalog, reviews, referrals and clinics',async()=>{
  for(const [route,endpoint] of [['specialties','/api/admin/specialties'],['wilayas','/api/admin/wilayas'],['reviews','/api/admin/reviews'],['referrals','/api/admin/referrals'],['patient-blocks','/api/admin/patient-blocks'],['clinics','/api/clinics/admin/list'],['doctors','/api/admin/doctors'],['appointments','/api/admin/appointments']]){failed=endpoint;await goto('/admin/'+route);await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).waitFor();assert.equal(await page.locator('main h1:visible').count(),1);failed='';await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).click();await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).waitFor({state:'hidden'});}
 });
 await test('failed mocked save retains fields and reports no false success',async()=>{
  await goto('/admin/specialties');await page.getByRole('button',{name:'إضافة تخصص',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'اسم التخصص'}).fill('تخصص تجريبي');await dialog.getByRole('textbox',{name:'الوصف (اختياري)'}).fill('وصف محفوظ');failed='/api/admin/specialties';let n=writes.length;await dialog.getByRole('button',{name:'إضافة',exact:true}).click();await page.getByRole('alert').filter({hasText:'حدث خطأ مؤقت في خادم MedBook'}).waitFor();assert.equal(await dialog.getByRole('textbox',{name:'اسم التخصص'}).inputValue(),'تخصص تجريبي');assert.equal(await dialog.getByRole('textbox',{name:'الوصف (اختياري)'}).inputValue(),'وصف محفوظ');assert.equal(await page.getByText('تمت الإضافة.',{exact:true}).count(),0);assert.equal(writes.length,n+1);failed='';await page.setViewportSize({width:390,height:400});await dialog.getByRole('button',{name:'إلغاء'}).scrollIntoViewIfNeeded();const box=await dialog.getByRole('button',{name:'إلغاء'}).boundingBox();assert.ok(box.y>=0&&box.y+box.height<=400);await dialog.getByRole('button',{name:'إلغاء'}).click();
 });
 await test('sensitive catalog, geography and review actions fit mobile and stay hidden',async()=>{
  await page.setViewportSize({width:360,height:640});for(const route of ['specialties','wilayas','reviews','doctors']){await goto('/admin/'+route);const d=page.locator('details:visible').first();await d.locator('summary').waitFor();assert.equal(await d.getAttribute('open'),null);await d.locator('summary').click();for(const b of await d.getByRole('button').all()){let box=await b.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=360);assert.ok(box.height>=44);}await d.locator('summary').press('Escape');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 });
 await test('no JavaScript errors',async()=>assert.deepEqual(errors,[]));
 // Review baseline uses exactly the same mocked records.
 for(const width of [390,1280])for(const route of ['appointments','users']){await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:5188/admin/'+route,{waitUntil:'domcontentloaded'});await page.locator('table').waitFor();await page.screenshot({path:path.join(out,'screenshots',`before-${route}-${width}.png`),fullPage:true});}
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({base,results,errors,writes,externalRequests:'blocked; all API requests fulfilled in browser',limits:['No real administrator writes','No physical keyboard or screen reader verification','No production database snapshots']},null,2));
 await browser.close();if(results.some(r=>r.status==='failed'))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
