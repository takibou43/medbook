import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";

// All removals/deactivations serialize against the same lock: two administrators
// cannot each observe the other as the remaining active administrator.
export async function changeUserAccess(userId: string, active: boolean | null, actor?: string, reason?:string) {
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724001)`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw ApiError.notFound("المستخدم غير موجود.");
      if (active !== true && userId === actor) throw ApiError.badRequest("لا يمكنك حذف حسابك الحالي أو تعطيله.");
      if (active !== true && user.role === Role.ADMIN) {
        const [all, enabled] = await Promise.all([tx.user.count({where:{role:Role.ADMIN}}),tx.user.count({where:{role:Role.ADMIN,isActive:true}})]);
        if ((active === null && all <= 1) || (user.isActive && enabled <= 1)) throw ApiError.badRequest("لا يمكن حذف آخر مدير فعّال أو تعطيله.");
      }
      if (active === null) {
        if (await tx.clinic.findUnique({where:{ownerId:userId},select:{id:true}})) throw ApiError.conflict("الحساب يملك عيادة. عطّل الحساب بدل حذفه للحفاظ على بيانات العيادة.");
        await tx.user.delete({where:{id:userId}});
        if(actor)await tx.auditLog.create({data:{userId:actor,action:"DELETE_USER",entity:"User",entityId:userId,meta:{reason}}});
        return null;
      }
      const {passwordHash: _omit,...safe}=await tx.user.update({where:{id:userId},data:{isActive:active}});
      if(actor)await tx.auditLog.create({data:{userId:actor,action:active?"ACTIVATE_USER":"DEACTIVATE_USER",entity:"User",entityId:userId,meta:{reason}}});
      return safe;
    });
  } catch (error) {
    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2003') throw ApiError.conflict("الحساب مرتبط بسجلات محفوظة. عطّله بدل حذفه.");
    throw error;
  }
}

export const normalizeCatalogName=(value:string)=>value.trim().replace(/\s+/g,' ');
type CatalogKind='specialty'|'wilaya'|'city';
const delegate=(tx:Prisma.TransactionClient,kind:CatalogKind):any=>tx[kind];
export async function saveCatalog(kind:CatalogKind,id:string|null,input:Record<string,unknown>){
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(724002)`;
  const data={...input};
  if(typeof data.nameAr==='string')data.nameAr=normalizeCatalogName(data.nameAr);
  if(typeof data.nameFr==='string')data.nameFr=normalizeCatalogName(data.nameFr);
  const model=delegate(tx,kind);
  const existing=id?await model.findUnique({where:{id}}):null;
  if(id&&!existing)throw ApiError.notFound("السجل غير موجود.");
  const name=data.nameAr??existing?.nameAr;
  const scope=kind==='city'?{wilayaId:data.wilayaId??existing?.wilayaId}:{};
  if(kind==='city'&&data.wilayaId&&!await tx.wilaya.findUnique({where:{id:String(data.wilayaId)},select:{id:true}}))throw ApiError.notFound('الولاية غير موجودة.');
  if(await model.findFirst({where:{...scope,nameAr:{equals:name,mode:'insensitive'},...(id?{id:{not:id}}:{})}}))throw ApiError.conflict("يوجد سجل بالاسم نفسه. عدّل السجل الموجود بدل إنشاء تكرار.");
  if(kind==='wilaya'&&data.code&&await tx.wilaya.findFirst({where:{code:String(data.code),...(id?{id:{not:id}}:{})}}))throw ApiError.conflict("رمز الولاية مستخدم مسبقًا.");
  return id?model.update({where:{id},data}):model.create({data});
 });
}
export async function removeCatalog(kind:CatalogKind,id:string){
 return prisma.$transaction(async tx=>{
  if(kind==='specialty')await tx.$queryRaw`SELECT id FROM specialties WHERE id=${id} FOR UPDATE`;
  if(kind==='city')await tx.$queryRaw`SELECT id FROM cities WHERE id=${id} FOR UPDATE`;
  if(kind==='wilaya'){
   await tx.$queryRaw`SELECT id FROM wilayas WHERE id=${id} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM cities WHERE "wilayaId"=${id} FOR UPDATE`;
  }
  const doctors=await tx.doctor.count({where:kind==='specialty'?{specialtyId:id}:kind==='city'?{cityId:id}:{wilayaId:id}});
  const clinics=kind==='specialty'?0:await tx.clinic.count({where:kind==='city'?{cityId:id}:{wilayaId:id}});
  const patients=kind==='specialty'?0:await tx.patient.count({where:kind==='city'?{cityId:id}:{city:{wilayaId:id}}});
  if(doctors||clinics||patients)throw ApiError.conflict("السجل مستخدم في ملفات أو عناوين محفوظة. يمكنك تعديل اسمه مع الحفاظ على معرفه.");
  return delegate(tx,kind).delete({where:{id}});
 });
}
