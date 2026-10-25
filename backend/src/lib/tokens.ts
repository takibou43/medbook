import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";

/**
 * أُخرجت من auth.service.ts (كانت مكررة محليًا هناك) حتى تُستعمل أيضًا من وحدة
 * assistants عند تسجيل حساب مساعد جديد بعد قبول الدعوة — بدون تكرار الكود ودون أي
 * تغيير في سلوك إصدار/تخزين التوكنات الحالي.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueTokens(userId: string, role: Role) {
  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = signRefreshToken({ sub: userId });

  const decoded = verifyRefreshToken(refreshToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(refreshToken), expiresAt },
  });

  return { accessToken, refreshToken, decoded };
}

/**
 * حذف توكنات التجديد التي لم تعد صالحة لأي شيء: المنتهية، والملغاة منذ أكثر من يومين.
 * التحقق في refresh() يقبل فقط توكنًا غير ملغى وغير منتهٍ، فحذفها لا يغيّر أي سلوك؛
 * دونه يكبر الجدول بلا حد (توكن جديد مع كل تجديد ≈ كل 15 دقيقة لكل جلسة مفتوحة).
 */
export const REVOKED_TOKEN_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export async function purgeStaleRefreshTokens(now = new Date()): Promise<number> {
  const revokedBefore = new Date(now.getTime() - REVOKED_TOKEN_RETENTION_MS);
  const result = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { revoked: true, createdAt: { lt: revokedBefore } }] },
  });
  return result.count;
}
