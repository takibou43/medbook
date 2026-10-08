import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { signAccessToken } from "../src/utils/jwt";
const ID="11111111-1111-4111-8111-111111111111";
const db=vi.hoisted(()=>({
  user:{findUnique:vi.fn(async({where}:any)=>({id:where.id,role:where.id==='admin'?'ADMIN':'PATIENT',isActive:true})),findMany:vi.fn(),count:vi.fn()},
  doctor:{findMany:vi.fn(),count:vi.fn()},appointment:{findMany:vi.fn(),count:vi.fn()},patient:{findMany:vi.fn()},doctorMessage:{findMany:vi.fn()},
}));
vi.mock('../src/lib/prisma',()=>({prisma:db}));
let app:any;
beforeAll(async()=>{app=(await import('../src/app')).createApp();});
beforeEach(()=>{vi.clearAllMocks();for(const model of [db.user,db.doctor,db.appointment]){model.findMany.mockResolvedValue([]);model.count.mockResolvedValue(0);}db.patient.findMany.mockResolvedValue([]);db.doctorMessage.findMany.mockResolvedValue([]);});
const auth=(role:'ADMIN'|'PATIENT')=>'Bearer '+signAccessToken({sub:role==='ADMIN'?'admin':'patient',role});
describe('admin deep links on protected HTTP routes',()=>{
 for(const kind of ['users','doctors','appointments'] as const){
  it(kind+': validates ID and filters by exact record',async()=>{
   const res=await request(app).get('/api/admin/'+kind).query({id:ID}).set('Authorization',auth('ADMIN'));
   expect(res.status).toBe(200);
   const model=kind==='users'?db.user:kind==='doctors'?db.doctor:db.appointment;
   const where=model.findMany.mock.calls[0][0].where;
   expect(kind==='users'?where.AND:where).toEqual(kind==='users'?expect.arrayContaining([{id:ID}]):expect.objectContaining({id:ID}));
  });
  it(kind+': rejects malformed ID',async()=>{expect((await request(app).get('/api/admin/'+kind).query({id:'invalid'}).set('Authorization',auth('ADMIN'))).status).toBe(400);});
  it(kind+': rejects non-admin and unauthenticated access',async()=>{
   expect((await request(app).get('/api/admin/'+kind).query({id:ID})).status).toBe(401);
   expect((await request(app).get('/api/admin/'+kind).query({id:ID}).set('Authorization',auth('PATIENT'))).status).toBe(403);
  });
 }
 it('appointments retain family beneficiary in the response selection',async()=>{
  await request(app).get('/api/admin/appointments').query({id:ID}).set('Authorization',auth('ADMIN'));
  expect(db.appointment.findMany.mock.calls[0][0].select).toMatchObject({familyMemberId:true,familyMember:{select:{firstName:true,lastName:true}}});
 });
 it('search returns account ID for patients and preserves family identity',async()=>{
  db.patient.findMany.mockResolvedValue([{id:'patient-id',firstName:'صاحب',lastName:'الحساب',user:{id:ID,phone:'000'}}]);
  const res=await request(app).get('/api/admin/search').query({q:'ليلى'}).set('Authorization',auth('ADMIN'));
  expect(res.status).toBe(200);expect(res.body.data.patients[0].userId).toBe(ID);
  expect(db.appointment.findMany.mock.calls[0][0].select.familyMemberId).toBe(true);
 });
});
