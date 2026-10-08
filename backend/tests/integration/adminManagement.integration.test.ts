import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
const url=process.env.TEST_DATABASE_URL,tag='admin-management-'+Date.now();
describe.skipIf(!url)('Admin management on isolated PostgreSQL',()=>{
 let db:PrismaClient,app:any,sign:any,a:any,b:any,patientUser:any,doctorUser:any,patient:any,doctor:any,w:any,c:any,sp:any,clinic:any,baseline:{id:string;isActive:boolean}[]=[];
 const auth=(u:any)=>({Authorization:'Bearer '+sign({sub:u.id,role:u.role})});
 beforeAll(async()=>{
  const parsed=new URL(url!);if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||!['/medbook_security_test','/medbook_admin_test'].includes(parsed.pathname))throw Error('Only named loopback test databases are permitted');
  process.env.DATABASE_URL=url!;process.env.NODE_ENV='test';process.env.BUDGETSMS_USERNAME='';process.env.BUDGETSMS_USERID='';process.env.BUDGETSMS_HANDLE='';process.env.VAPID_PRIVATE_KEY='';process.env.VAPID_PUBLIC_KEY='';
  db=new PrismaClient({datasourceUrl:url});baseline=await db.user.findMany({where:{role:'ADMIN'},select:{id:true,isActive:true}});
  const user=(name:string,role:any)=>db.user.create({data:{email:name+'.'+tag+'@example.test',role,passwordHash:'unused-test-hash'}});
  a=await user('admin-a','ADMIN');b=await user('admin-b','ADMIN');patientUser=await user('patient','PATIENT');doctorUser=await user('doctor','DOCTOR');
  w=await db.wilaya.create({data:{code:tag.slice(-8),nameAr:tag}});c=await db.city.create({data:{wilayaId:w.id,nameAr:'بلدية '+tag}});sp=await db.specialty.create({data:{nameAr:'تخصص '+tag}});
  patient=await db.patient.create({data:{userId:patientUser.id,firstName:'مريض',lastName:tag,cityId:c.id}});
  clinic=await db.clinic.create({data:{nameAr:'عيادة '+tag,address:'عنوان اختبار',wilayaId:w.id,cityId:c.id,ownerId:doctorUser.id,paidDoctorCount:5,verificationStatus:'VERIFIED',subscriptionStatus:'ACTIVE',subscriptionExpiresAt:new Date(Date.now()+86400000*30)}});
  doctor=await db.doctor.create({data:{userId:doctorUser.id,firstName:'طبيب',lastName:tag,specialtyId:sp.id,wilayaId:w.id,cityId:c.id,clinicId:clinic.id,address:'عنوان اختبار'}});
  sign=(await import('../../src/utils/jwt')).signAccessToken;app=(await import('../../src/app')).createApp();
 },60000);
 beforeEach(async()=>{await db.user.updateMany({where:{id:{in:[a.id,b.id]}},data:{isActive:true}});});
 afterAll(async()=>{
  if(!db)return;for(const row of baseline)await db.user.update({where:{id:row.id},data:{isActive:row.isActive}});
  process.env.MEDBOOK_DEMO_USER_IDS='';
  await db.auditLog.deleteMany({where:{userId:{in:[a.id,b.id]}}});await db.doctor.update({where:{id:doctor.id},data:{clinicId:null}});await db.clinic.delete({where:{id:clinic.id}});await db.user.deleteMany({where:{id:{in:[a.id,b.id,patientUser.id,doctorUser.id]}}});await db.specialty.delete({where:{id:sp.id}});await db.city.delete({where:{id:c.id}});await db.wilaya.delete({where:{id:w.id}});await db.specialty.deleteMany({where:{nameAr:{contains:tag}}});await db.city.deleteMany({where:{nameAr:{contains:tag}}});await db.$disconnect();await (await import('../../src/lib/prisma')).prisma.$disconnect();
 });
 it('HTTP self-deactivation and patient access are rejected; roles and profiles survive ordinary deactivation',async()=>{
  expect((await request(app).patch('/api/admin/users/'+a.id+'/deactivate').set(auth(a)).send({reason:'اختبار'})).status).toBe(400);
  expect((await request(app).patch('/api/admin/users/'+a.id+'/deactivate').set(auth(patientUser)).send({})).status).toBe(403);
  const before=await db.user.findUnique({where:{id:patientUser.id},include:{patient:true}});
  expect((await request(app).patch('/api/admin/users/'+patientUser.id+'/deactivate').set(auth(a)).send({reason:'اختبار التعطيل'})).status).toBe(200);
  const after=await db.user.findUnique({where:{id:patientUser.id},include:{patient:true}});expect(after?.role).toBe(before?.role);expect(after?.passwordHash).toBe(before?.passwordHash);expect(after?.patient?.id).toBe(before?.patient?.id);
  await db.user.update({where:{id:patientUser.id},data:{isActive:true}});
 });
 it('concurrent deactivation leaves one active administrator and last-account deletion is refused',async()=>{
  const {changeUserAccess}=await import('../../src/modules/admin/adminSafety.service');
  await db.user.updateMany({where:{role:'ADMIN',id:{notIn:[a.id,b.id]}},data:{isActive:false}});
  const results=await Promise.allSettled([changeUserAccess(a.id,false,b.id),changeUserAccess(b.id,false,a.id)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await db.user.count({where:{role:'ADMIN',isActive:true}})).toBe(1);
  const last=await db.user.findFirst({where:{role:'ADMIN',isActive:true}});await expect(changeUserAccess(last!.id,null)).rejects.toMatchObject({statusCode:400});
  for(const row of baseline)await db.user.update({where:{id:row.id},data:{isActive:row.isActive}});
 });
 it('catalog updates retain identifiers and relations; used city/specialty/wilaya cannot be deleted',async()=>{
  for(const [kind,id] of [['specialties',sp.id],['wilayas',w.id],['cities',c.id]])expect((await request(app).delete('/api/admin/'+kind+'/'+id).set(auth(a))).status).toBe(409);
  expect((await request(app).patch('/api/admin/specialties/'+sp.id).set(auth(a)).send({nameAr:'اسم محفوظ '+tag})).status).toBe(200);
  expect((await db.doctor.findUnique({where:{id:doctor.id}}))?.specialtyId).toBe(sp.id);
  expect((await request(app).patch('/api/admin/cities/'+c.id).set(auth(a)).send({nameAr:'بلدية محفوظة '+tag})).status).toBe(200);
  expect((await db.patient.findUnique({where:{id:patient.id}}))?.cityId).toBe(c.id);
 });
 it('concurrent normalized duplicates create only one row; blank and excess fields are refused',async()=>{
  const body={nameAr:'اسم متزامن '+tag};const results=await Promise.all([request(app).post('/api/admin/specialties').set(auth(a)).send(body),request(app).post('/api/admin/specialties').set(auth(b)).send({nameAr:'  اسم   متزامن '+tag+'  '})]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
  expect((await request(app).post('/api/admin/specialties').set(auth(a)).send({nameAr:'  '})).status).toBe(400);
  expect((await request(app).patch('/api/admin/cities/'+c.id).set(auth(a)).send({nameAr:'اسم',wilayaId:w.id})).status).toBe(400);
 });
 it('clinic revision rejects a stale edit and keeps capacity, price and expiry unchanged',async()=>{
  const before=await db.clinic.findUnique({where:{id:clinic.id}});const list=await request(app).get('/api/clinics/admin/list').query({page:1,id:clinic.id}).set(auth(a));expect(list.status).toBe(200);expect(list.body.data.items[0]).toMatchObject({paidDoctorCount:5,doctorPrice:4000,billedDoctorCount:1,monthlyTotal:4000});
  expect((await request(app).patch('/api/clinics/admin/'+clinic.id).set(auth(a)).send({expectedSnapshot:'stale',paidDoctorCount:7})).status).toBe(409);
  expect(await db.clinic.findUnique({where:{id:clinic.id}})).toMatchObject({paidDoctorCount:before!.paidDoctorCount,subscriptionExpiresAt:before!.subscriptionExpiresAt});
  expect((await request(app).patch('/api/clinics/admin/'+clinic.id).set(auth(a)).send({expectedSnapshot:list.body.data.items[0].revision,paidDoctorCount:-1})).status).toBe(400);
 });
 it('maintenance has no domain-based candidates and blocks linked/admin records',async()=>{
  process.env.MEDBOOK_DEMO_USER_IDS='';expect((await request(app).get('/api/admin/maintenance/demo-preview').set(auth(a))).body.data.records).toEqual([]);
  process.env.MEDBOOK_DEMO_USER_IDS=a.id;const preview=await request(app).get('/api/admin/maintenance/demo-preview').set(auth(a));expect(preview.body.data.records[0].eligible).toBe(false);expect((await request(app).post('/api/admin/maintenance/purge-demo-data').set(auth(a)).send({records:preview.body.data.records.map((r:any)=>({id:r.id,version:r.version}))})).status).toBe(409);
  expect((await request(app).post('/api/admin/maintenance/purge-demo-data').set(auth(a)).send({})).status).toBe(400);process.env.MEDBOOK_DEMO_USER_IDS='';
 });
});
