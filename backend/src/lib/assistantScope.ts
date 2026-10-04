import { Prisma } from "@prisma/client";

type Scope = { clinicId: string | null; doctorId: string; allDoctors?: boolean; allowedDoctorIds?: string[] };

/** Always intersect the owner's assignment with current membership and active accounts. */
export function assistantDoctorWhere(scope: Scope): Prisma.DoctorWhereInput {
  return {
    ...(scope.clinicId
      ? { clinicId: scope.clinicId, ...(scope.allDoctors === false ? { id: { in: scope.allowedDoctorIds ?? [] } } : {}) }
      : { id: scope.doctorId }),
    user: { isActive: true },
  };
}
