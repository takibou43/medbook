const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATIENT_ORIGINS = new Set(['https://medbook-alpha.vercel.app', 'https://medbook-auto-dz.vercel.app', 'https://medbook-git-main-auto-dz.vercel.app']);
/** Normalize our printed attendance code or the existing public doctor booking QR. */
export function arrivalCodeFromQr(raw: string, currentOrigin: string): string | null {
 const value = raw.trim();
 const code = /^medbook-arrival:v1:(clinic|doctor):(.+)$/i.exec(value);
 if (code && UUID.test(code[2])) return 'medbook-arrival:v1:' + code[1].toLowerCase() + ':' + code[2].toLowerCase();
 try {
  const url = new URL(value);
  if (url.username || url.password || ![...PATIENT_ORIGINS, currentOrigin].includes(url.origin)) return null;
  if (url.protocol !== 'https:' && !(url.origin === currentOrigin && url.protocol === 'http:')) return null;
  if (url.pathname === '/account/arrival') {
   const codes = url.searchParams.getAll('code');
   if (codes.length !== 1 || !/^medbook-arrival:v1:(clinic|doctor):[0-9a-f-]{36}$/i.test(codes[0])) return null;
   return arrivalCodeFromQr(codes[0], currentOrigin);
  }
  if (url.pathname !== '/') return null;
  const doctors = url.searchParams.getAll('doctor');
  if (doctors.length !== 1 || !UUID.test(doctors[0])) return null;
  return 'medbook-arrival:v1:doctor:' + doctors[0].toLowerCase();
 } catch { return null; }
}
