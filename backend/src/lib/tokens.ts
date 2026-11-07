import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken, type RefreshTokenPayload } from "../utils/jwt";

/**
 * أُخرجت من auth.service.ts (كانت مكررة محليًا هناك) حتى تُستعمل أيضًا من وحدة
 * assistants عند تسجيل حساب مساعد جديد بعد قبول الدعوة — بدون تكرار الكود ودون أي
 * تغيير في سلوك إصدار/تخزين التوكنات الحالي.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** أقصى عمر للجلسة منذ تسجيل الدخول، مهما تكرر التجديد. بعده يُطلب تسجيل الدخول من جديد. */
export const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** sessionStartedAt: بداية الجلسة الأصلية (عند التدوير)؛ تسجيل دخول جديد = الآن. */
export async function issueTokens(userId: string, role: Role, sessionStartedAt: number = Date.now()) {
  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = signRefreshToken({ sub: userId, sst: Math.floor(sessionStartedAt / 1000) });

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

/** بداية الجلسة من التوكن. التوكنات القديمة بلا sst تُعامَل كأنها بدأت الآن (لا خروج جماعي عند النشر). */
export function sessionStartOf(decoded: RefreshTokenPayload, now = Date.now()): number {
  return typeof decoded.sst === "number" && Number.isFinite(decoded.sst) ? decoded.sst * 1000 : now;
}

export function sessionTooOld(decoded: RefreshTokenPayload, now = Date.now()): boolean {
  return now - sessionStartOf(decoded, now) > MAX_SESSION_AGE_MS;
}

/**
 * كشف إعادة استعمال توكن تجديد سبق تدويره (علامة سرقة الجلسة).
 * تبويبان يجدّدان بالتوكن نفسه في اللحظة نفسها أمر طبيعي: يُسجَّل التوكن هنا قبل إبطاله، فيُعامَل
 * أي طلب متأخر به خلال دقيقة كسباق عادي (401 فقط). بعد الدقيقة = إعادة استعمال → تُبطَل كل جلسات الحساب.
 * الذاكرة محلية في نسخة الخادم الوحيدة (Render المجاني)، وتُفرَّغ تلقائيًا.
 */
export const REFRESH_REUSE_GRACE_MS = 60_000;
const rotating = new Map<string, number>();

export function markRefreshRotating(tokenHash: string, now = Date.now()): void {
  if (rotating.size > 5000) {
    for (const [hash, at] of rotating) if (now - at > REFRESH_REUSE_GRACE_MS) rotating.delete(hash);
  }
  rotating.set(tokenHash, now);
}

export async function revokeAllOnRefreshReuse(userId: string, tokenHash: string, now = Date.now()): Promise<boolean> {
  const markedAt = rotating.get(tokenHash);
  if (markedAt !== undefined && now - markedAt <= REFRESH_REUSE_GRACE_MS) return false;
  const reused = await prisma.refreshToken.findFirst({ where: { userId, tokenHash, revoked: true }, select: { id: true } });
  if (!reused) return false;
  await prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
  console.warn("[auth] refresh token reuse detected: all sessions of the account were revoked");
  return true;
}
