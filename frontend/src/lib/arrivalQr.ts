const SIGNED_CODE = /^medbook-arrival:v2:(clinic|doctor):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}$/;
const PATIENT_ORIGINS = new Set(['https://medbook-alpha.vercel.app', 'https://medbook-auto-dz.vercel.app', 'https://medbook-git-main-auto-dz.vercel.app']);
/** Only signed attendance posters can authorize arrival; public booking QRs cannot. */
export function arrivalCodeFromQr(raw: string, currentOrigin: string): string | null {
 const value = raw.trim();
 if (SIGNED_CODE.test(value)) return value;
 try {
  const url = new URL(value);
  if (url.username || url.password || ![...PATIENT_ORIGINS, currentOrigin].includes(url.origin)) return null;
  if (url.protocol !== 'https:' && !(url.origin === currentOrigin && url.protocol === 'http:')) return null;
  if (url.pathname === '/account/arrival') {
   const codes = url.searchParams.getAll('code');
   return codes.length === 1 && SIGNED_CODE.test(codes[0]) ? codes[0] : null;
  }
  return null;
 } catch { return null; }
}
