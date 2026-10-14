/** Preserve the active text field across a short native Android dialog in the installed app.
 * No text is copied or stored. Page taps, navigation and longer app switches cancel restoration.
 */
export function preserveNativeKeyboardFocus(win: Window = window, doc: Document = document): () => void {
  if (!/Android/i.test(win.navigator.userAgent) || !win.matchMedia("(display-mode: standalone)").matches) return () => {};
  type Field = HTMLInputElement | HTMLTextAreaElement;
  type Snapshot = { field: Field; start: number | null; end: number | null; direction: "forward" | "backward" | "none" | null; url: string; at: number };
  const editable = (element: Element | null): element is Field => Boolean(element &&
    (element.tagName === "TEXTAREA" || (element.tagName === "INPUT" && /^(text|search|tel|url|email|password|number)$/.test((element as HTMLInputElement).type))) &&
    !(element as Field).disabled && !(element as Field).readOnly);
  let last: Field | null = null;
  let lostAt = 0;
  let pending: Snapshot | null = null;
  let frame = 0;
  const cancel = () => { pending = null; win.cancelAnimationFrame(frame); frame = 0; };
  const remember = () => { cancel(); last = editable(doc.activeElement) ? doc.activeElement : null; lostAt = 0; };
  const focusOut = () => { lostAt = Date.now(); };
  const suspend = () => {
    const field = editable(doc.activeElement) ? doc.activeElement : lostAt && Date.now() - lostAt < 250 ? last : null;
    if (!field || !editable(field)) return;
    pending = { field, start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection, url: win.location.href, at: Date.now() };
  };
  const resume = () => {
    if (!pending || doc.hidden) return;
    const snapshot = pending;
    frame = win.requestAnimationFrame(() => {
      if (pending !== snapshot) return;
      pending = null; frame = 0;
      const active = doc.activeElement;
      if (Date.now() - snapshot.at > 30_000 || win.location.href !== snapshot.url || !snapshot.field.isConnected || !editable(snapshot.field) || snapshot.field.closest('[inert], [hidden], [aria-hidden="true"]') || !snapshot.field.getClientRects().length) return;
      if (active && active !== doc.body && active !== doc.documentElement && active !== snapshot.field) return;
      snapshot.field.focus({ preventScroll: true });
      if (snapshot.start !== null && snapshot.end !== null) {
        try { snapshot.field.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction ?? undefined); } catch { /* Number/email fields do not support caret APIs. */ }
      }
    });
  };
  const visibility = () => { if (doc.hidden) suspend(); else resume(); };
  const pageGesture = () => { cancel(); last = null; };
  const key = (event: KeyboardEvent) => { if (event.key === "Tab" || event.key === "Escape") pageGesture(); };
  doc.addEventListener("focusin", remember);
  doc.addEventListener("focusout", focusOut);
  doc.addEventListener("pointerdown", pageGesture, true);
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("visibilitychange", visibility);
  win.addEventListener("blur", suspend);
  win.addEventListener("focus", resume);
  win.addEventListener("pagehide", pageGesture);
  win.addEventListener("popstate", pageGesture);
  return () => {
    cancel(); last = null;
    doc.removeEventListener("focusin", remember);
    doc.removeEventListener("focusout", focusOut);
    doc.removeEventListener("pointerdown", pageGesture, true);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("visibilitychange", visibility);
    win.removeEventListener("blur", suspend);
    win.removeEventListener("focus", resume);
    win.removeEventListener("pagehide", pageGesture);
    win.removeEventListener("popstate", pageGesture);
  };
}
