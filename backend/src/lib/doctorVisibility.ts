type ClinicBilling = {
  ownerId: string | null;
  owner?: { isActive: boolean } | null;
  verificationStatus: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: Date | null;
  paidDoctorCount: number;
};

export type DoctorVisibilityProfile = {
  verificationStatus?: string;
  subscriptionStatus: string;
  subscriptionExpiresAt?: Date | null;
  user?: { isActive: boolean };
  clinic?: ClinicBilling | null;
};

export function hasEffectiveDoctorSubscription(doctor: DoctorVisibilityProfile, now = new Date()) {
  if (doctor.user?.isActive === false) return false;
  const clinic = doctor.clinic;
  if (clinic?.ownerId) {
    return clinic.owner?.isActive === true && clinic.verificationStatus === "VERIFIED" &&
      clinic.subscriptionStatus === "ACTIVE" && clinic.paidDoctorCount > 0 &&
      !!clinic.subscriptionExpiresAt && clinic.subscriptionExpiresAt > now;
  }
  return doctor.subscriptionStatus === "ACTIVE" &&
    (!doctor.subscriptionExpiresAt || doctor.subscriptionExpiresAt > now);
}

export function isDoctorProfilePublic(doctor: DoctorVisibilityProfile, now = new Date()) {
  return doctor.verificationStatus === "VERIFIED" && hasEffectiveDoctorSubscription(doctor, now);
}
