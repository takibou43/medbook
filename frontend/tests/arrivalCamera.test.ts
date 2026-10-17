import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cameraErrorMessage } from '../src/lib/arrivalCamera.ts';
test('patient deployment permits same-origin camera and continues blocking microphone', () => {
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 const policy=config.headers.find((r:any)=>r.source==='/(.*)').headers.find((h:any)=>h.key==='Permissions-Policy').value;
 assert.match(policy,/camera=\(self\)/); assert.match(policy,/microphone=\(\)/);
});
test('camera errors distinguish permission, missing device and busy hardware', () => {
 assert.match(cameraErrorMessage({name:'NotAllowedError'}),/السماح بالكاميرا/);
 assert.match(cameraErrorMessage({name:'NotFoundError'}),/لم يتم العثور/);
 assert.match(cameraErrorMessage({name:'NotReadableError'}),/مشغولة/);
});
