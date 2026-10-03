import type { CookieOptions, Response } from "express";
import { env } from "../config/env";

/**
 * كوكيّا التجديد للواجهتين — لكلٍّ اسم ومسار مستقلان (لم يتغيّرا عن السابق):
 *   الأطباء/المساعدون/الإدارة: medbook_refresh      على المسار /api/auth
 *   المرضى:                    medbook_patient_refresh على المسار /api/patient/auth
 * يُجمَعان هنا لأن الحساب ذا الملفين ينتقل بين الواجهتين فيحتاج المسار الأول إلى ضبط كوكي الثاني
 * (من خلال استدعاء مصادَق بـBearer من الواجهة الأولى، فلا يظهر أي رمز سري في أي رابط URL).
 */
export const DOCTOR_REFRESH_COOKIE = "medbook_refresh";
export const DOCTOR_COOKIE_PATH = "/api/auth";
export const PATIENT_REFRESH_COOKIE = "medbook_patient_refresh";
export const PATIENT_COOKIE_PATH = "/api/patient/auth";

function base(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProd,
    // الواجهة والخادم على نطاقين مختلفين في الإنتاج: "none" + secure؛ وفي التطوير المحلي "lax".
    sameSite: env.isProd ? "none" : "lax",
    path,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export const doctorCookieOptions = (): CookieOptions => base(DOCTOR_COOKIE_PATH);
export const patientCookieOptions = (): CookieOptions => base(PATIENT_COOKIE_PATH);

export function setDoctorSession(res: Response, refreshToken: string) {
  res.cookie(DOCTOR_REFRESH_COOKIE, refreshToken, doctorCookieOptions());
}
export function setPatientSession(res: Response, refreshToken: string) {
  res.cookie(PATIENT_REFRESH_COOKIE, refreshToken, patientCookieOptions());
}

const { maxAge: _a, ...doctorClear } = base(DOCTOR_COOKIE_PATH);
const { maxAge: _b, ...patientClear } = base(PATIENT_COOKIE_PATH);
void _a; void _b;
export function clearDoctorSession(res: Response) {
  res.clearCookie(DOCTOR_REFRESH_COOKIE, doctorClear);
}
export function clearPatientSession(res: Response) {
  res.clearCookie(PATIENT_REFRESH_COOKIE, patientClear);
}
