// Local browser regression: fake camera and mocked APIs only; no production data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
const require=createRequire(import.meta.url);
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
   const canvas=document.createElement('canvas'); canvas.width=320;canvas.height=240;
   const draw=()=>{const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,320,240);};draw();
   const stream=canvas.captureStream(15);const timer=setInterval(draw,50);
   for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}
   window.testTracks.push(...stream.getTracks());return stream;
  };
 });
 await context.route('**/api/**',async route=>{
  const request=route.request(); const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const data=request.url().includes('/patient/auth/me')?{id:'test-user',role:'PATIENT',email:'test@example.invalid',patient:{id:'test-patient',firstName:'اختبار',lastName:'محلي'}}:[];
  await route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({success:true,data})});
 });
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
 const blocked=await context.newPage();
 await blocked.route('**/account/arrival',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'permissions-policy':'camera=(), microphone=()'}});});
 await blocked.goto(base+'/account/arrival',{waitUntil:'domcontentloaded'});
 await blocked.getByRole('status').filter({hasText:'السماح بالكاميرا مطلوب'}).waitFor({timeout:30000});
 console.log('PASS blocked camera policy reproduces the failure with a specific permission message');
 await context.close();
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
