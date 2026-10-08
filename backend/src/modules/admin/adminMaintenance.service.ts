import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';

// Explicit IDs supplied by the operator; mail domains never establish eligibility.
function configuredIds(){return [...new Set((process.env.MEDBOOK_DEMO_USER_IDS??'').split(',').map(s=>s.trim()).filter(s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)))].slice(0,100);}
async function preview(db:Prisma.TransactionClient|typeof prisma){
 const users=await db.user.findMany({where:{id:{in:configuredIds()}},select:{id:true,email:true,role:true,updatedAt:true,ownedClinic:{select:{id:true}},doctor:{select:{id:true}},patient:{select:{id:true}}}});
 const records=await Promise.all(users.map(async u=>{
  const appointments=await db.appointment.count({where:{OR:[...(u.doctor?[{doctorId:u.doctor.id}]:[]),...(u.patient?[{patientId:u.patient.id}]:[])]}});
  const medicalRecords=(u.patient?await db.familyMember.count({where:{ownerPatientId:u.patient.id}}):0)+await db.dentalTreatmentPlan.count({where:{OR:[...(u.doctor?[{doctorId:u.doctor.id}]:[]),...(u.patient?[{patientId:u.patient.id}]:[])]}});
  return {id:u.id,email:u.email,role:u.role,version:u.updatedAt.toISOString(),appointments,medicalRecords,eligible:u.role!=='ADMIN'&&!u.ownedClinic&&!appointments&&!medicalRecords};
 }));
 return {configured:configuredIds().length>0,records,policy:'يسمح فقط بمعرفات تجريبية محددة صراحة؛ الحسابات الإدارية والعيادات والسجلات المرتبطة محمية.'};
}
export const previewDemoData=()=>preview(prisma);
export async function purgeReviewedDemoData(expected:{id:string;version:string}[],actor:string,reason?:string){
 if(!expected.length)throw ApiError.badRequest('اختر سجلات من المعاينة أولًا.');
 try{return await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(724003)`;
  const ids=expected.map(r=>r.id);await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`);
  const snapshot=await preview(tx);
  for(const target of expected){const actual=snapshot.records.find(r=>r.id===target.id);if(!actual||!actual.eligible||actual.version!==target.version||target.id===actor)throw ApiError.conflict('تغيرت السجلات أو لم تعد مؤهلة. أعد المعاينة.');}
  // Database RESTRICT constraints remain authoritative for other linked records.
  await tx.user.deleteMany({where:{id:{in:ids},role:{not:'ADMIN'}}});
  await tx.auditLog.create({data:{userId:actor,action:'PURGE_DEMO_DATA',entity:'User',meta:{ids,reason}}});
  return {users:ids.length};
 });}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2003')throw ApiError.conflict('الحساب مرتبط بسجلات محفوظة. أعد المعاينة.');throw error;}
}
