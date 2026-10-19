import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalCodeFromQr } from '../src/lib/arrivalQr.ts';
const origin='https://medbook-alpha.vercel.app';
const id='11111111-1111-4111-8111-111111111111';
test('accepts signed clinic and doctor attendance codes, never public booking IDs',()=>{
 for (const kind of ['clinic','doctor']) {
  const code='medbook-arrival:v2:'+kind+':'+id+':'+ 'a'.repeat(64);
  assert.equal(arrivalCodeFromQr(code,origin),code);
  assert.equal(arrivalCodeFromQr(origin+'/account/arrival?code='+encodeURIComponent(code),origin),code);
 }
 assert.equal(arrivalCodeFromQr(origin+'/?doctor='+id,origin),null);
 assert.equal(arrivalCodeFromQr('medbook-arrival:v1:clinic:'+id,origin),null);
});

test('does not follow external links or accept ambiguous or invalid QR values',()=>{
 for(const raw of ['https://evil.example/?doctor='+id,origin+'/account?doctor='+id,origin+'/?doctor='+id+'&doctor='+id,'javascript:alert(1)','medbook-arrival:v1:doctor:not-a-uuid',origin+'/?doctor=invalid','https://name:password@medbook-alpha.vercel.app/?doctor='+id]) assert.equal(arrivalCodeFromQr(raw,origin),null,raw);
});
