import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { Role } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string; // userId
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtAccessExpires as any });
}

export function signRefreshToken(payload: { sub: string }): string {
  // jwtid عشوائي: بدونه يكون توكنان صادران لنفس المستخدم في نفس الثانية متطابقين حرفيًا (نفس sub وiat
  // وexp)، فيحمل التوكن "الجديد" بعد التدوير نفس بصمة القديم ويبقى القديم صالحًا عمليًا. التحقق لا يتأثر.
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshExpires as any, jwtid: randomUUID() });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { sub: string };
}
