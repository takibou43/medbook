import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalCodeFromQr } from '../src/lib/arrivalQr.ts';
const origin='https://medbook-alpha.vercel.app';
const id='11111111-1111-4111-8111-111111111111';
test('accepts both printed attendance codes and the existing doctor booking QR',()=>{
 assert.equal(arrivalCodeFromQr('medbook-arrival:v1:clinic:'+id,origin),'medbook-arrival:v1:clinic:'+id);
 assert.equal(arrivalCodeFromQr(origin+'/?doctor='+id,origin),'medbook-arrival:v1:doctor:'+id);
 assert.equal(arrivalCodeFromQr(origin+'/account/arrival?code='+encodeURIComponent('medbook-arrival:v1:doctor:'+id),origin),'medbook-arrival:v1:doctor:'+id);
});
test('does not follow external links or accept ambiguous or invalid QR values',()=>{
 for(const raw of ['https://evil.example/?doctor='+id,origin+'/account?doctor='+id,origin+'/?doctor='+id+'&doctor='+id,'javascript:alert(1)','medbook-arrival:v1:doctor:not-a-uuid',origin+'/?doctor=invalid','https://name:password@medbook-alpha.vercel.app/?doctor='+id]) assert.equal(arrivalCodeFromQr(raw,origin),null,raw);
});
