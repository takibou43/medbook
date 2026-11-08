import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { MAX_PAYMENT_DZD } from './subscriptionCalendar';
export const subscriptionFilters = ['ALL','TRIAL','PAID','SOON','EXPIRED','STOPPED','NONE','CLINIC'] as const;
export type SubscriptionFilter = typeof subscriptionFilters[number];
export function subscriptionWhere(filter: SubscriptionFilter, now = new Date()): Prisma.DoctorWhereInput {
 const individual: Prisma.DoctorWhereInput = { OR: [{clinicId:null},{clinic:{ownerId:null}}] };
 const live: Prisma.DoctorWhereInput = { subscriptionStatus:'ACTIVE', OR:[{subscriptionExpiresAt:null},{subscriptionExpiresAt:{gt:now}}] };
 const conditions: Record<SubscriptionFilter,Prisma.DoctorWhereInput> = {
 ALL:{}, CLINIC:{clinic:{ownerId:{not:null}}},
 TRIAL:{AND:[individual,live,{newDoctorTrial:true}]}, PAID:{AND:[individual,live,{newDoctorTrial:false}]},
 SOON:{AND:[individual,{subscriptionStatus:'ACTIVE',subscriptionExpiresAt:{gt:now,lte:new Date(now.getTime()+7*86400000)}}]},
 EXPIRED:{AND:[individual,{subscriptionExpiresAt:{lte:now}}]},
 STOPPED:{AND:[individual,{subscriptionStatus:{not:'ACTIVE'},subscriptionExpiresAt:{gt:now}}]},
 NONE:{AND:[individual,{subscriptionStatus:{not:'ACTIVE'},subscriptionExpiresAt:null}]}
 };return conditions[filter];
}
// Manual receipts only. EDAHABIA is deliberately not accepted until verified provider settlement exists.
export const manualReceiptSchema=z.object({
 amountDzd:z.number().int().min(1).max(MAX_PAYMENT_DZD),
 paidAt:z.string().datetime({offset:true}).refine(v=>Date.parse(v)<=Date.now(),'تاريخ الدفع لا يمكن أن يكون في المستقبل.'),
 method:z.enum(['CASH','CCP_TRANSFER','BANK_TRANSFER']),
 reference:z.string().trim().max(100).optional(),
 note:z.string().trim().max(500).optional(),
}).strict().refine(v=>v.method==='CASH'||!!v.reference,'مرجع التحويل مطلوب.');
export type ManualReceipt=z.infer<typeof manualReceiptSchema>;
