import { prisma } from './prisma';
import { hashToken } from './tokens';
import { verifyRefreshToken } from '../utils/jwt';

/** A stale cookie is never authority to revoke newer sessions. */
export async function revokeSession(refreshToken: string | undefined, allSessions = false) {
  if (!refreshToken) return;
  const tokenHash = hashToken(refreshToken);
  if (!allSessions) {
    await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revoked: true } });
    return;
  }
  let subject: string;
  try { subject = verifyRefreshToken(refreshToken).sub; } catch { return; }
  await prisma.$transaction(async tx => {
    const row = await tx.refreshToken.findFirst({
      where: { tokenHash, userId: subject, revoked: false, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true },
    });
    if (!row) return;
    // Claim the current session atomically against refresh/logout races.
    const claimed = await tx.refreshToken.updateMany({ where: { id: row.id, revoked: false, expiresAt: { gt: new Date() } }, data: { revoked: true } });
    if (claimed.count !== 1) return;
    await tx.refreshToken.updateMany({ where: { userId: row.userId, revoked: false }, data: { revoked: true } });
  });
}
