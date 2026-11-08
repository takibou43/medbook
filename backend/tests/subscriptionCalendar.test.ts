import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {addCalendarMonths,renewalQuote,readBillingSchedule,DAY_MS} from '../src/lib/subscriptionCalendar';
const at=(s:string)=>Date.parse(s+'T00:00:00+01:00');
describe('calendar subscription entitlement',()=>{
 it.each([['2026-01-08','2026-02-08',31],['2026-02-08','2026-03-08',28],['2028-02-08','2028-03-08',29],['2026-04-08','2026-05-08',30]] as const)('uses the real month from %s', (from,to,days)=>{
  const q=renewalQuote(5000,0,at(from));expect(q.after).toBe(at(to));expect(q.durationMs).toBe(days*DAY_MS);
 });
 it('grants 365 or 366 days for twelve calendar months',()=>{
  expect(renewalQuote(60000,0,at('2026-11-08')).durationMs).toBe(365*DAY_MS);
  expect(renewalQuote(60000,0,at('2027-11-08')).after).toBe(at('2028-11-08'));
  expect(renewalQuote(60000,0,at('2027-11-08')).durationMs).toBe(366*DAY_MS);
  expect(renewalQuote(60000,0,at('2028-02-29')).after).toBe(at('2029-02-28'));
 });
 it('preserves day 31 through February and uses Algeria dates',()=>{
  const first=renewalQuote(5000,0,at('2026-01-31'));
  expect(first.after).toBe(at('2026-02-28'));
  expect(renewalQuote(5000,first.after,at('2026-02-28'),first.schedule).after).toBe(at('2026-03-31'));
  expect(addCalendarMonths(Date.parse('2026-01-30T23:30:00Z'),1)).toBe(Date.parse('2026-02-27T23:30:00Z'));
 });
 it('prorates 8000 over the actual next month and preserves sub-day credit',()=>{
  expect(renewalQuote(8000,0,at('2026-11-08')).after).toBe(Date.parse('2026-12-26T14:24:00+01:00'));
  expect(renewalQuote(8000,0,at('2026-02-08')).durationMs).toBe(28*DAY_MS+31*DAY_MS*3/5);
  expect(renewalQuote(1,0,at('2026-02-08')).durationMs).toBe(28*DAY_MS/5000);
 });
 it('split amounts and twelve monthly renewals equal their combined payment',()=>{
  const now=at('2026-01-31');
  for(const chunks of [[5000,3000,2000],[8000,2000],[1,4999,5000],Array(12).fill(5000)]) {
   let end=now,schedule=null as ReturnType<typeof readBillingSchedule>;
   for(const amount of chunks){const q=renewalQuote(amount,end,now,schedule);end=q.after;schedule=q.schedule;}
   expect(end).toBe(renewalQuote(chunks.reduce((a,b)=>a+b,0),0,now).after);
  }
 });
 it('retains remaining time and restarts after expiry or manual date changes',()=>{
  const now=at('2026-11-08'),old=renewalQuote(5000,0,at('2026-01-31'));
  expect(renewalQuote(5000,at('2026-11-13'),now).after).toBe(at('2026-12-13'));
  expect(renewalQuote(5000,old.after,now,old.schedule).after).toBe(at('2026-12-08'));
  expect(renewalQuote(5000,at('2026-11-13'),now,old.schedule).after).toBe(at('2026-12-13'));
 });
 it.each([0,-1,NaN,Infinity,1.5,600001])('rejects invalid amount %s',amount=>expect(()=>renewalQuote(amount,0,at('2026-01-01'))).toThrow());
 it('keeps the staff preview and server calculator identical',()=>{
  expect(readFileSync(new URL('../src/lib/subscriptionCalendar.ts',import.meta.url),'utf8')).toBe(readFileSync(new URL('../../frontend-doctor/src/lib/subscriptionCalendar.ts',import.meta.url),'utf8'));
 });
});
