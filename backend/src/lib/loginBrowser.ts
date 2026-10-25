import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { env } from "../config/env";
const COOKIE = "medbook_login_browser";
const TTL = 7 * 86400000;
const sign = (s: string) => createHmac("sha256", env.jwtSecret).update(`login-browser:v1:${s}`).digest("hex");
const identity = (email: string) => sign(`email:${email.trim().toLowerCase()}`);
// This hint only isolates rate-limit budgets; a valid password is always required.
export function rememberLoginBrowser(res: Response, email: string): void {
  const payload = `${identity(email)}.${Date.now() + TTL}`;
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: env.isProd, sameSite: env.isProd ? "none" : "lax", path: "/api", maxAge: TTL });
}
export function isKnownLoginBrowser(req: Request): boolean {
  const email = req.body?.email, token = req.cookies?.[COOKIE];
  if (typeof email !== "string" || email.length > 254 || typeof token !== "string" || token.length > 200) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [account, expiry, mac] = parts;
  if (!/^\d{13}$/.test(expiry) || Number(expiry) <= Date.now() || Number(expiry) > Date.now() + TTL || !/^[a-f0-9]{64}$/.test(mac)) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(sign(`${account}.${expiry}`))) && account === identity(email);
}
