import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/ApiError";
import catalog from "../data/algeria-specialties.json";

export const specialtyNameSchema = z.string().trim().min(2, "اسم التخصص قصير جدًا").max(120, "اسم التخصص طويل جدًا").regex(/^[\p{L}\p{M}\p{N}\s()،,.'’/&+-]+$/u, "اسم التخصص غير صالح");

export async function resolveSpecialtyId(tx: Prisma.TransactionClient, input: { specialtyId?: string; specialtyName?: string }) {
  if (input.specialtyId && input.specialtyName) throw ApiError.badRequest("اختر تخصصًا أو اكتب اسمه.");
  if (input.specialtyId) {
    const existing = await tx.specialty.findUnique({ where: { id: input.specialtyId }, select: { id: true } });
    if (!existing) throw ApiError.badRequest("التخصص غير موجود.");
    return existing.id;
  }
  const parsed = specialtyNameSchema.safeParse(input.specialtyName);
  if (!parsed.success) throw ApiError.badRequest("اختر التخصص أو اكتب اسمًا صالحًا (من 2 إلى 120 حرفًا).");
  const typedName = parsed.data.replace(/\s+/g, " ").normalize("NFC");
  const normalize = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s'-]/g, "");
  const reference = catalog.find(names => names.some(name => normalize(name) === normalize(typedName)));
  const nameAr = reference?.[0] ?? typedName;
  const nameFr = reference?.[1];
  const lookupNames = [...new Set([nameAr, typedName, ...(nameFr ? [nameFr] : [])])];
  const existing = await tx.specialty.findFirst({
    where: { OR: lookupNames.flatMap(name => [{ nameAr: { equals: name, mode: "insensitive" as const } }, { nameFr: { equals: name, mode: "insensitive" as const } }]) },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.specialty.upsert({ where: { nameAr }, update: {}, create: { nameAr, ...(nameFr ? { nameFr } : {}), icon: "stethoscope" }, select: { id: true } });
  return created.id;
}
