import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * كتابة سطر في AuditLog — يمكن تمريره عميل معاملة (tx) ليُكتب ذرّيًا مع العملية نفسها.
 * meta: معرّفات وتواريخ وأرقام فقط — لا أسرار ولا بيانات طبية ولا أرقام هواتف.
 */
export async function writeAudit(
  entry: { userId?: string | null; action: string; entity?: string; entityId?: string; meta?: Record<string, unknown> },
  db: Prisma.TransactionClient = prisma
) {
  await db.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      meta: (entry.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
