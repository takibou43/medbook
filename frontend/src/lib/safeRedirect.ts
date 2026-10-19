/** Validate after URL normalization, including backslashes and control characters. */
export function safeRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(raw)) return '/account';
  try {
    const base = 'https://medbook.invalid';
    const url = new URL(raw, base);
    return url.origin === base ? url.pathname + url.search + url.hash : '/account';
  } catch { return '/account'; }
}
