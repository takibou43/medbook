import {describe,it,expect} from 'vitest';
import {manualReceiptSchema,subscriptionWhere} from '../src/lib/subscriptionAdmin';
describe('manual subscription receipts',()=>{
 const receipt={amountDzd:15000,paidAt:'2026-01-01T12:00:00+01:00',method:'CASH'};
 it('accepts cash without bank reference',()=>expect(manualReceiptSchema.safeParse(receipt).success).toBe(true));
 it.each([0,-1,1.5,600001])('rejects invalid amount %s',amountDzd=>expect(manualReceiptSchema.safeParse({...receipt,amountDzd}).success).toBe(false));
 it('rejects future dates',()=>expect(manualReceiptSchema.safeParse({...receipt,paidAt:'2099-01-01T00:00:00Z'}).success).toBe(false));
 it('requires reference for transfer',()=>expect(manualReceiptSchema.safeParse({...receipt,method:'CCP_TRANSFER'}).success).toBe(false));
 it('accepts transfer with reference',()=>expect(manualReceiptSchema.safeParse({...receipt,method:'BANK_TRANSFER',reference:'BANK-123'}).success).toBe(true));
 it('rejects a fake electronically verified payment',()=>expect(manualReceiptSchema.safeParse({...receipt,method:'EDAHABIA',status:'SUCCEEDED'}).success).toBe(false));
 it('rejects client-supplied card data',()=>expect(manualReceiptSchema.safeParse({...receipt,cardNumber:'1234'}).success).toBe(false));
});
describe('subscription filters',()=>{
 const now=new Date('2026-11-08T00:00:00Z');
 it('limits the complete subscription list to individually billed doctors',()=>expect(subscriptionWhere('ALL',now)).toEqual({OR:[{clinicId:null},{clinic:{ownerId:null}}]}));
 it('uses one precise seven-day range',()=>expect(subscriptionWhere('SOON',now)).toMatchObject({AND:[expect.anything(),{subscriptionStatus:'ACTIVE',subscriptionExpiresAt:{gt:now,lte:new Date('2026-11-15T00:00:00Z')}}]}));
 it('keeps clinic billing separate',()=>expect(subscriptionWhere('CLINIC',now)).toEqual({clinic:{ownerId:{not:null}}}));
 it('uses expiration boundary inclusively',()=>expect(subscriptionWhere('EXPIRED',now)).toMatchObject({AND:[expect.anything(),{subscriptionExpiresAt:{lte:now}}]}));
});
