/** Event metadata only: never record keys, input data, values, labels or element IDs. */
export function observeKeyboardFocus(win: Window, doc: Document, report: (line: string) => void): () => void {
  const ids = new WeakMap<object, number>(); let next = 0;
  let field: Element | null = null;
  const start = Date.now();
  const identify = (target: EventTarget | null): string => {
    if (target === win) return 'window';
    if (target === doc) return 'document';
    if (!target || !('tagName' in target)) return 'none';
    const element = target as Element;
    if (!ids.has(element)) ids.set(element, ++next);
    return `${element.tagName.toLowerCase()}#${ids.get(element)}`;
  };
  const log = (event: string, target: EventTarget | null) => report(`${Date.now() - start}ms ${event} target=${identify(target)} active=${identify(doc.activeElement)} pageFocus=${doc.hasFocus()} hidden=${doc.hidden} height=${win.innerHeight}/${Math.round(win.visualViewport?.height ?? win.innerHeight)}`);
  const focus = (event: Event) => {
    if (event.type === 'focusin' && event.target && 'tagName' in event.target && /^(INPUT|TEXTAREA)$/.test(String(event.target.tagName))) field = event.target as Element;
    log(event.type, event.target);
  };
  const key = (event: KeyboardEvent) => {
    if (event.keyCode === 229 || event.isComposing) log('IME-key', event.target);
    else if (event.key === 'Escape' || event.key === 'Tab') log(event.key, event.target);
  };
  const resize = () => log('viewport-resize', win);
  const observer = new (win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver(() => {
    if (field && !field.isConnected) { log('field-removed', field); field = null; }
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  for (const name of ['focusin', 'focusout', 'compositionstart', 'compositionend', 'pointerdown', 'visibilitychange']) doc.addEventListener(name, focus, true);
  doc.addEventListener('keydown', key, true);
  win.addEventListener('blur', focus);
  win.addEventListener('focus', focus);
  win.visualViewport?.addEventListener('resize', resize);
  win.addEventListener('resize', resize);
  log('start', doc);
  return () => {
    observer.disconnect();
    for (const name of ['focusin', 'focusout', 'compositionstart', 'compositionend', 'pointerdown', 'visibilitychange']) doc.removeEventListener(name, focus, true);
    doc.removeEventListener('keydown', key, true);
    win.removeEventListener('blur', focus); win.removeEventListener('focus', focus);
    win.visualViewport?.removeEventListener('resize', resize); win.removeEventListener('resize', resize);
  };
}
