/** Resume only an invitation in this app, never an external redirect. */
export function clinicInviteReturnPath(value: unknown): string | null {
  return typeof value === "string" && /^\/clinic\/doctor\/accept\/[a-f0-9]{64}$/.test(value) ? value : null;
}

export function canAcceptClinicInvite(user: { role: string; email: string } | null, invitedEmail: string): boolean {
  return !!user && user.role === "DOCTOR" && user.email.trim().toLowerCase() === invitedEmail.trim().toLowerCase();
}
