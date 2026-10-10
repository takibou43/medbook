import type { TreatmentPlanSummary } from "../types/index.ts";

/** Keep both account and beneficiary when plans are opened from a consultation. */
export function plansForBeneficiary<T extends Pick<TreatmentPlanSummary, "patientId" | "familyMemberId">>(plans: T[], patientId: string, memberId: string): T[] {
  return plans.filter(plan => plan.patientId === patientId && (plan.familyMemberId ?? "") === memberId);
}
