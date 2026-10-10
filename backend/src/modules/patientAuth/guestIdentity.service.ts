import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { sendSms } from "../../lib/sms";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { lockDoctorCalls } from "../../lib/doctorLock";
import { writeAudit } from "../../lib/audit";
import { ApiError } from "../../utils/ApiError";
import { assertReception } from "../shifts/shifts.service";

export const identityName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function identityPhone(s: string) {
  const digits = s.replace(/\D/g, "");
  const local = digits.startsWith("213") ? "0" + digits.slice(3) : digits;
  return /^0[5-7]\d{8}$/.test(local) ? local : null;
}
const digest = (patientId: string, phone: string, code: string) => crypto.createHmac("sha256", env.jwtSecret).update(`${patientId}:${phone}:${code}`).digest("hex");
async function profile(userId: string) {
  const patient = await prisma.patient.findUnique({ where: { userId }, include: { user: { select: { phone: true } } } });
  if (!patient) throw ApiError.notFound("ملف المريض غير موجود.");
  const phone = identityPhone(patient.user.phone ?? "");
  if (!phone || !patient.firstName.trim() || !patient.lastName.trim()) throw ApiError.badRequest("أكمل الاسم واللقب ورقم الهاتف في حسابك أولًا.");
  return { patient, phone };
}

export async function identityState(userId: string) {
  const { patient, phone } = await profile(userId);
  const claim = await prisma.guestIdentityClaim.findUnique({ where: { patientId: patient.id } });
  return { verified: !!claim?.verifiedAt && claim.expiresAt > new Date() && claim.phone === phone && identityName(claim.firstName) === identityName(patient.firstName) && identityName(claim.lastName) === identityName(patient.lastName),
    pending: !!claim && !claim.verifiedAt && claim.expiresAt > new Date() };
}

export async function sendIdentityCode(userId: string) {
  const { patient, phone } = await profile(userId);
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = digest(patient.id, phone, code);
  const now = new Date();
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"guest-code:" + phone}, 0))`;
    const existing = await tx.guestIdentityClaim.findUnique({ where: { patientId: patient.id } });
    if (existing && now.getTime() - existing.lastSentAt.getTime() < 60000) throw ApiError.badRequest("انتظر دقيقة قبل طلب رمز جديد.");
    const count = await tx.guestIdentityClaim.aggregate({ where: { phone, lastSentAt: { gt: new Date(now.getTime() - 86400000) } }, _sum: { sentCount: true } });
    if ((count._sum.sentCount ?? 0) >= 5) throw ApiError.badRequest("تم بلوغ حد التحقق لهذا الرقم اليوم.");
    const sentCount = existing && now.getTime() - existing.lastSentAt.getTime() < 86400000 ? existing.sentCount + 1 : 1;
    const data = { phone, firstName: patient.firstName, lastName: patient.lastName, codeHash, expiresAt: new Date(now.getTime() + 600000), attempts: 0, verifiedAt: null, lastSentAt: now, sentCount };
    await tx.guestIdentityClaim.upsert({ where: { patientId: patient.id }, create: { patientId: patient.id, ...data }, update: data });
  });
  const sent = await sendSms(phone, `MedBook: رمز التحقق ${code}. صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`);
  if (!sent.success) {
    await prisma.guestIdentityClaim.updateMany({ where: { patientId: patient.id, codeHash }, data: { codeHash: "", expiresAt: new Date(0) } });
    throw ApiError.unavailable("تعذّر إرسال رمز التحقق. حاول لاحقًا أو راجع العيادة.");
  }
  return { sent: true };
}

export async function verifyIdentityCode(userId: string, code: string) {
  const { patient, phone } = await profile(userId);
  const valid = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"guest-code:" + phone}, 0))`;
    const claim = await tx.guestIdentityClaim.findUnique({ where: { patientId: patient.id } });
    if (!claim || claim.verifiedAt || claim.expiresAt <= new Date() || claim.attempts >= 5 || claim.phone !== phone || identityName(claim.firstName) !== identityName(patient.firstName) || identityName(claim.lastName) !== identityName(patient.lastName)) return false;
    const expected = digest(patient.id, phone, code);
    if (claim.codeHash.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(claim.codeHash))) {
      await tx.guestIdentityClaim.update({ where: { id: claim.id }, data: { attempts: { increment: 1 } } });
      return false;
    }
    await tx.guestIdentityClaim.update({ where: { id: claim.id }, data: { verifiedAt: new Date(), codeHash: "", expiresAt: new Date(Date.now() + 7 * 86400000) } });
    return true;
  });
  if (!valid) throw ApiError.badRequest("رمز غير صالح أو منتهي. اطلب رمزًا جديدًا عند الحاجة.");
  return { verified: true, awaitingClinicConfirmation: true };
}

export async function guestClaimCandidates(userId: string, role: Role) {
  const doctorId = await resolveActingDoctorId(userId, role);
  const claims = await prisma.guestIdentityClaim.findMany({ where: { verifiedAt: { not: null }, expiresAt: { gt: new Date() } }, include: { patient: { include: { user: { select: { phone: true } } } } }, take: 200 });
  if (!claims.length) return [];
  const appointments = await prisma.appointment.findMany({ where: { doctorId, patientId: null, familyMemberId: null, guestPhone: { in: claims.flatMap(c => [c.phone, "+213" + c.phone.slice(1), "213" + c.phone.slice(1)]) } }, select: { id: true, date: true, startTime: true, guestFirstName: true, guestLastName: true, guestPhone: true }, take: 1000 });
  return claims.filter(c => identityPhone(c.patient.user.phone ?? "") === c.phone && identityName(c.patient.firstName) === identityName(c.firstName) && identityName(c.patient.lastName) === identityName(c.lastName))
    .map(c => ({ claimId: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone,
      appointments: appointments.filter(a => identityPhone(a.guestPhone ?? "") === c.phone && identityName(a.guestFirstName ?? "") === identityName(c.firstName) && identityName(a.guestLastName ?? "") === identityName(c.lastName)).map(a => ({ id: a.id, date: a.date, startTime: a.startTime })) }))
    .filter(c => c.appointments.length);
}

export async function confirmGuestClaim(userId: string, role: Role, claimId: string, appointmentId: string) {
  const doctorId = await resolveActingDoctorId(userId, role);
  return prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, doctorId);
    if (role === Role.ASSISTANT) await assertReception(userId, role, doctorId, tx);
    const claim = await tx.guestIdentityClaim.findUnique({ where: { id: claimId }, include: { patient: { include: { user: { select: { phone: true } } } } } });
    const a = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!claim?.verifiedAt || claim.expiresAt <= new Date() || !a || a.doctorId !== doctorId || a.patientId || a.familyMemberId || identityPhone(a.guestPhone ?? "") !== claim.phone || identityPhone(claim.patient.user.phone ?? "") !== claim.phone || identityName(a.guestFirstName ?? "") !== identityName(claim.firstName) || identityName(a.guestLastName ?? "") !== identityName(claim.lastName) || identityName(claim.patient.firstName) !== identityName(claim.firstName) || identityName(claim.patient.lastName) !== identityName(claim.lastName))
      throw ApiError.conflict("لا يمكن ربط السجل. تحقق من هوية المريض وبياناته ثم حدّث القائمة.");
    const updated = await tx.appointment.updateMany({ where: { id: a.id, patientId: null, familyMemberId: null }, data: { patientId: claim.patientId } });
    if (updated.count !== 1) throw ApiError.conflict("تم ربط السجل أو تغييره للتو.");
    await writeAudit({ userId, action: "GUEST_IDENTITY_CONFIRMED", entity: "Appointment", entityId: a.id, meta: { claimId, patientId: claim.patientId } }, tx);
    return { linked: true };
  });
}
