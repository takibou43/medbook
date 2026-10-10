import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plansForBeneficiary} from '../src/lib/treatmentWorkflow.ts';

test('consultation plans preserve account and beneficiary, including identical names', () => {
  const plans = [{patientId:'p1',familyMemberId:null,title:'خطة'}, {patientId:'p1',familyMemberId:'fm1',title:'خطة'}, {patientId:'p1',familyMemberId:'fm2',title:'خطة'}, {patientId:'p2',familyMemberId:null,title:'خطة'}];
  assert.deepEqual(plansForBeneficiary(plans,'p1','fm1'), [plans[1]]);
  assert.deepEqual(plansForBeneficiary(plans,'p1',''), [plans[0]]);
  assert.deepEqual(plansForBeneficiary(plans,'p2',''), [plans[3]]);
  assert.deepEqual(plansForBeneficiary(plans,'p2','fm1'), []);
  assert.equal(plans.length,4);
});
