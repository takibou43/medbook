const {chromium}=require('playwright');
const fs=require('fs'), path=require('path'), assert=require('node:assert/strict');
const {fixture,A,B,U,AP}=require('./fixture-api.cjs');
const results=[], errors=[];
const base=process.env.REVIEW_URL||'http://127.0.0.1:5188';
const mode=process.env.REVIEW_MODE||'after';
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/benz/.cache/puppeteer/chrome/win64-154.0.8037.57/chrome-win64/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1280,height:900},locale:'ar-DZ'});
 await context.addInitScript(()=>localStorage.setItem('medbook_doctor_access_token','local-fixture-only'));
 let failSend=false, delaySend=false, sent=[], failRecipient=false, slowSearch=false;
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.startsWith('/api/')){
   if(slowSearch && url.pathname==='/api/admin/doctors' && url.searchParams.get('q')==='أحمد')await new Promise(r=>setTimeout(r,1000));
   if(failRecipient&&url.pathname==='/api/admin/doctors')return route.fulfill({status:404,json:{success:false,message:'الطبيب غير موجود'}});
   if(req.method()==='POST'&&url.pathname.endsWith('/messages')){sent.push({url:req.url(),body:req.postDataJSON()});if(failSend==='network')return route.abort('internetdisconnected');if(delaySend)await new Promise(r=>setTimeout(r,300));if(failSend)return route.fulfill({status:500,json:{success:false,message:'فشل تجريبي في الإرسال'}});}
   const data=fixture(url,req.method(),req.postData()?req.postDataJSON():{});
   return route.fulfill({status:data===null?404:200,json:{success:data!==null,data,message:data===null?'Unavailable fixture':undefined}}).catch(()=>{});
  }
  if(url.hostname==='127.0.0.1'||url.hostname==='localhost')return route.continue();
  return route.abort();
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.stack));
 const out=path.resolve('docs/admin-phase1/screenshots');fs.mkdirSync(out,{recursive:true});
 const test=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.message});}};
 await page.goto(base+'/admin/messages?doctor='+A);
 await page.getByRole('textbox',{name:mode==='before'?'':'رسالة إلى د. أحمد بن علي'}).count();
 await page.locator('textarea').waitFor();
 await page.locator('input').first().fill('لااسممطابق');await page.waitForTimeout(700);
 await page.screenshot({path:path.join(out,mode+'-messages-desktop.png'),fullPage:true});
 if(mode==='before'){
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'before-messages-mobile.png'),fullPage:true});
  await page.goto(base+'/admin/reviews');await page.locator('main').waitFor();await page.screenshot({path:path.join(out,'before-reviews-mobile.png'),fullPage:true});await browser.close();return;
 }
 await test('search retains recipient name and specialty',async()=>{await page.getByText('لا نتائج مطابقة.').waitFor();assert.equal(await page.getByText('د. أحمد بن علي',{exact:true}).count(),1);assert.equal(await page.getByText('طب القلب',{exact:true}).count(),1);});
 await test('drafts stay with each recipient',async()=>{
  await page.locator('textarea').fill('مسودة أحمد');await page.locator('input').first().fill('');await page.waitForTimeout(500);
  await page.getByRole('button').filter({hasText:'سارة Martin'}).click();assert.equal(await page.locator('textarea').inputValue(),'');await page.locator('textarea').fill('مسودة سارة');
  await page.getByRole('button').filter({hasText:'أحمد بن علي'}).click();assert.equal(await page.locator('textarea').inputValue(),'مسودة أحمد');
 });
 await test('failed send retains text and retry key; duplicate submit sends once',async()=>{
  failSend=true;sent=[];await page.getByRole('button',{name:'إرسال',exact:true}).click();await page.getByText('حدث خطأ مؤقت في خادم مادبوك. حاول مرة أخرى.',{exact:true}).waitFor();assert.equal(await page.locator('textarea').inputValue(),'مسودة أحمد');const first=sent[0].body.clientId;await page.getByRole('button').filter({hasText:'سارة Martin'}).click();await page.getByRole('button').filter({hasText:'أحمد بن علي'}).click();assert.equal(await page.locator('textarea').inputValue(),'مسودة أحمد');
  failSend=false;delaySend=true;await page.locator('textarea').press('Enter');await page.locator('textarea').press('Enter');await page.waitForTimeout(700);assert.equal(sent.length,2);assert.equal(sent[1].body.clientId,first);assert.equal(await page.locator('textarea').inputValue(),'');delaySend=false;
 });
 await test('deep links, reload, back and forward agree with selected record',async()=>{
  await page.goto(base+'/admin/doctors?id='+B);await page.getByText('د. سارة Martin — طب الأطفال',{exact:true}).waitFor();assert.equal(await page.getByText('د. أحمد بن علي — طب القلب',{exact:true}).count(),0);
  await page.reload();await page.getByText('د. سارة Martin — طب الأطفال',{exact:true}).waitFor();
  await page.goto(base+'/admin/appointments?id='+AP);await page.getByRole('cell',{name:'ليلى بن علي',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'صاحب الحساب',exact:true}).count(),0);
  await page.goBack();await page.getByText('د. سارة Martin — طب الأطفال',{exact:true}).waitFor();await page.goForward();await page.getByRole('cell',{name:'ليلى بن علي',exact:true}).waitFor();
 });
 await test('search and pagination survive reload and browser history',async()=>{
  await page.goto(base+'/admin/doctors?q=أحمد&page=2');await page.getByText('د. أحمد بن علي — طب القلب',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'بحث عن طبيب'}).inputValue(),'أحمد');await page.reload();await page.getByText('د. أحمد بن علي — طب القلب',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('page'),'2');
 });
 await test('global search opens the exact doctor, patient account and appointment',async()=>{
  for(const [label,target] of [['طبيب ·','/admin/doctors?id='+A],['مريض ·','/admin/users?role=PATIENT&id='+U],['موعد ·','/admin/appointments?id='+AP]]){await page.goto(base+'/admin');await page.getByRole('textbox',{name:'البحث العام في الإدارة'}).fill('أحمد');const link=page.getByRole('link').filter({hasText:label}).first();await link.waitFor();assert.equal(await link.getAttribute('href'),target);await link.click();assert.ok(page.url().endsWith(target));await page.goBack();assert.equal(await page.getByRole('textbox',{name:'البحث العام في الإدارة'}).inputValue(),'أحمد');}
 });
 await test('clinics card and activity links identify their destinations',async()=>{
  await page.goto(base+'/admin');await page.getByRole('link').filter({hasText:'العيادات'}).last().waitFor();assert.ok(await page.locator('a[href="/admin/clinics"]').count()>0);await page.getByRole('link').filter({hasText:'تأكيد موعد'}).waitFor();assert.equal(await page.getByRole('link').filter({hasText:'تأكيد موعد'}).getAttribute('href'),'/admin/appointments?id='+AP);
 });
 await test('review stars are a named image and deletion identifies the review',async()=>{
  await page.goto(base+'/admin/reviews');await page.getByRole('img',{name:'4 من 5'}).waitFor();assert.equal(await page.getByRole('button',{name:/حذف تقييم ليلى بن علي/}).count(),1);assert.equal(await page.locator('button[disabled]').count(),0);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'after-reviews-mobile.png'),fullPage:true});
 });
 await test('city modal includes wilaya, Escape closes it and restores focus',async()=>{
  await page.goto(base+'/admin/wilayas');const opener=page.getByRole('button',{name:'إضافة بلدية',exact:true});await opener.click();const dialog=page.getByRole('dialog',{name:'إضافة بلدية — ميلة'});await dialog.waitFor();await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.ok(await opener.evaluate(el=>el===document.activeElement));
 });
 await test('email has a real label and LTR direction',async()=>{
  await page.goto(base+'/admin/account');const email=page.getByLabel('البريد الإلكتروني',{exact:true});await email.waitFor();assert.equal(await email.getAttribute('dir'),'ltr');assert.equal(await email.getAttribute('autocomplete'),'email');
 });
 for(const width of [360,390,768,1280])await test('message viewport '+width+' and mobile return',async()=>{
  await page.setViewportSize({width,height:844});await page.goto(base+'/admin/messages?doctor='+A);await page.locator('textarea').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'after-messages-'+width+'.png'),fullPage:true});
  if(width<768){await page.getByRole('button',{name:'رجوع لقائمة المحادثات'}).click();await page.getByRole('textbox',{name:'بحث عن طبيب في المحادثات'}).waitFor();assert.equal(new URL(page.url()).searchParams.get('doctor'),null);}
 });
 await test('network failure preserves draft; editing a failed draft creates a new retry key',async()=>{
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/admin/messages?doctor='+A);await page.locator('textarea').waitFor();
  await page.locator('textarea').fill('مسودة الشبكة');failSend='network';sent=[];await page.getByRole('button',{name:'إرسال',exact:true}).click();
  await page.getByText('تعذّر الاتصال بخادم مادبوك. حاول مرة أخرى بعد قليل.',{exact:true}).waitFor();assert.equal(await page.locator('textarea').inputValue(),'مسودة الشبكة');const oldKey=sent[0].body.clientId;
  await page.locator('textarea').fill('نص مختلف');await page.getByRole('button').filter({hasText:'سارة Martin'}).click();await page.getByRole('button').filter({hasText:'أحمد بن علي'}).click();
  failSend=false;await page.getByRole('button',{name:'إرسال',exact:true}).click();await page.waitForTimeout(500);assert.equal(sent[1].body.content,'نص مختلف');assert.notEqual(sent[1].body.clientId,oldKey);assert.equal(await page.locator('textarea').inputValue(),'');
 });
 await test('late search cannot replace the newest results',async()=>{
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/admin/doctors');slowSearch=true;
  const search=page.getByRole('textbox',{name:'بحث عن طبيب'});await search.fill('أحمد');await page.waitForTimeout(400);await search.fill('سارة');
  await page.getByText('د. سارة Martin — طب الأطفال',{exact:true}).waitFor();await page.waitForTimeout(1100);
  assert.equal(await page.getByText('د. أحمد بن علي — طب القلب',{exact:true}).count(),0);assert.equal(await search.inputValue(),'سارة');slowSearch=false;
 });
 await test('unknown recipient disables composer',async()=>{
  failRecipient=true;await page.goto(base+'/admin/messages?doctor=99999999-9999-4999-8999-999999999999');await page.getByText('الإرسال معطل لأن هوية المستلم غير متاحة.').waitFor({timeout:15000});assert.equal(await page.locator('textarea').count(),0);failRecipient=false;
 });
 await browser.close();fs.writeFileSync('docs/admin-phase1/browser-results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));if(results.some(x=>x.status==='failed')||errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exit(1);});
