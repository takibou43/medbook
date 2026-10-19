import test from 'node:test';
import assert from 'node:assert/strict';
import { readPatientLatinName, rememberPatientLatinName, forgetPatientLatinName, validLatinPatientName } from '../src/lib/prescriptionPatientNames.ts';
import { draftHasContent, emptyDraft } from '../src/lib/prescription.ts';
const p = { appointmentId: 'visit-1', patientId: 'holder-1', familyMemberId: null, bookedName: 'اسم تجريبي', relationship: null, accountHolderName: null, appointmentDate: '2026-10-19', startTime: '10:00' };
test('reviewed names are isolated by doctor and actual beneficiary, not by account holder alone', () => {
 const data = new Map<string,string>();
 const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
 Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)} });
 try {
  assert.equal(rememberPatientLatinName('doctor1', p, "Émilie D’Ami"), true);
  assert.equal(readPatientLatinName('doctor1', {...p, appointmentId:'later-visit'}), "Émilie D’Ami");
  assert.equal(readPatientLatinName('doctor2', p), '');
  assert.equal(readPatientLatinName('doctor1', {...p, familyMemberId:'child-1'}), '');
  assert.equal(readPatientLatinName('doctor1', {...p, bookedName:'another person'}), '');
  assert.equal(rememberPatientLatinName('doctor1', {...p, familyMemberId:'child-1'}, 'Test Child'), true);
  assert.equal(readPatientLatinName('doctor1', {...p, familyMemberId:'child-1'}), 'Test Child');
  assert.equal(forgetPatientLatinName('doctor1', p), true);
  assert.equal(readPatientLatinName('doctor1', p), '');
  assert.equal(readPatientLatinName('doctor1', {...p, familyMemberId:'child-1'}), 'Test Child');
  data.set('medbook-prescription-latin-names-v1:doctor1', '{corrupt');
  assert.equal(readPatientLatinName('doctor1', p), '');
 } finally { if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage'); }
});
test('Latin names are optional, bounded and never guessed; edits protect the draft from rebinding',()=>{
 assert.equal(validLatinPatientName(''),false);
 assert.equal(validLatinPatientName('Test اسم'),false);
 assert.equal(validLatinPatientName('Test\nName'),false);
 assert.equal(validLatinPatientName('A'.repeat(161)),false);
 assert.equal(validLatinPatientName("Émilie D’Ami"),true);
 assert.equal(draftHasContent({...emptyDraft('doctor1',p),patientNameFr:'Reviewed Name'}),true);
});
