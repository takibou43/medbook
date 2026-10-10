const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.MEDBOOK_PLAYWRIGHT || 'C:/Users/benz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const doctor={id:'fixture-doctor',firstName:'آمنة',lastName:'بن علي',specialtyId:'specialty-1',specialty:{id:'specialty-1',nameAr:'طب الأسنان',nameFr:'Médecine dentaire'},wilayaId:'wilaya-1',wilaya:{id:'wilaya-1',code:'16',nameAr:'الجزائر',nameFr:'Alger'},city:{id:'city-1',nameAr:'الجزائر الوسطى'},cityId:'city-1',clinic:null,avgRating:0,reviewsCount:0,yearsExperience:5,languages:['العربية','Français'],consultationFee:2000,verificationStatus:'VERIFIED',subscriptionStatus:'ACTIVE'};
const result=[];
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.MEDBOOK_BROWSER_CHANNEL || 'chrome'});
 try {
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
   let data;
   if(url.pathname.endsWith('/wilayas'))data=[{...doctor.wilaya,cities:[doctor.city]}];
   else if(url.pathname.endsWith('/doctors'))data={items:[doctor],page:1,pageSize:50,total:1,totalPages:1};
   else if(url.pathname.endsWith('/next-slot'))data={date:'2026-10-12',startTime:'09:00',endTime:'09:20',durationMin:20};
   else if(url.pathname.endsWith('/specialties'))data=[doctor.specialty];
   else data=[];
   await route.fulfill({json:{data},headers:{'access-control-allow-origin':route.request().headers().origin || new URL(page.url()).origin,'access-control-allow-credentials':'true'}});
  });
  await page.goto('http://127.0.0.1:5183/account/login');
  const email=page.locator('input[type=email]');
  await email.fill('patient.fixture@example.test');
  await page.locator('input[type=password]').fill('fixturePassword123');
  await page.getByRole('button',{name:'Français',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
  assert.equal(await email.inputValue(),'patient.fixture@example.test');
  assert.equal(await page.locator('input[type=password]').inputValue(),'fixturePassword123');
  assert.ok(await page.getByText('Mon compte MedBook',{exact:true}).isVisible());
  await page.getByRole('button',{name:'العربية',exact:true}).click();
  assert.equal(await email.inputValue(),'patient.fixture@example.test');
  await page.goto('http://127.0.0.1:5183/');
  await page.getByRole('button',{name:/تبحث عن طبيب معين/}).click();
  const search=page.getByRole('textbox',{name:'اسم الطبيب'});
  await search.fill('آمنة');
  await search.focus();
  const handle=await search.elementHandle();
  await search.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'a'}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true}));});
  assert.equal(await page.getByRole('dialog').count(),1);
  await page.setViewportSize({width,height:420});
  await search.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'a'})));
  // A parent rerender used to rerun useDialogFocus and steal focus from the input.
  await page.getByRole('button',{name:'Français',exact:true}).evaluate(el=>el.click());
  await page.getByRole('dialog',{name:'Rechercher un médecin par son nom'}).waitFor();
  assert.equal(await handle.evaluate(el=>el===document.activeElement),true);
  assert.equal(await handle.evaluate(el=>el.value),'آمنة');
  assert.equal(await handle.evaluate(el=>getComputedStyle(el).fontSize),'16px');
  await page.setViewportSize({width,height:844});
  await page.screenshot({path:`docs/localization/patient-search-fr-${width}.local.png`,fullPage:true});
  await page.getByRole('button',{name:'Fermer',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.goto('http://127.0.0.1:5184/login');
  const staffEmail=page.locator('input[type=email]');await staffEmail.fill('doctor.fixture@example.test');
  await page.locator('input[type=password]').fill('staffFixturePassword123');
  await page.getByRole('button',{name:'Français',exact:true}).click();
  assert.equal(await staffEmail.inputValue(),'doctor.fixture@example.test');
  assert.equal(await page.locator('input[type=password]').inputValue(),'staffFixturePassword123');
  assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
  await page.screenshot({path:`docs/localization/staff-login-fr-${width}.local.png`,fullPage:true});
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('lang'),'fr');
  await page.getByRole('button',{name:'العربية',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
  assert.deepEqual(errors,[]);
  result.push({width,checks:['patient and staff form values survive language switch','French persists after reload','RTL/LTR switches','IME Escape does not close search','viewport resize retains search value','parent rerender retains focus','mobile inputs use 16px'],pageErrors:errors});
  await context.close();
 }
 fs.writeFileSync('docs/localization/mobile-verification.local.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});

