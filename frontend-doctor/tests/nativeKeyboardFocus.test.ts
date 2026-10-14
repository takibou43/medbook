import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preserveNativeKeyboardFocus } from '../src/lib/nativeKeyboardFocus.ts';

function fixture(android = true, installed = true) {
  const body = { tagName: 'BODY' }, html = { tagName: 'HTML' };
  const doc = Object.assign(new EventTarget(), { activeElement: body as unknown, body, documentElement: html, hidden: false });
  const frames = new Map<number, FrameRequestCallback>(); let seq = 0;
  const win = Object.assign(new EventTarget(), { navigator: { userAgent: android ? 'Android' : 'Linux' }, matchMedia: () => ({ matches: installed }), location: { href: 'https://medbook-doctor.vercel.app/profile' }, requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++seq, fn); return seq; }, cancelAnimationFrame: (id: number) => { frames.delete(id); } });
  const field = { tagName: 'INPUT', type: 'text', disabled: false, readOnly: false, isConnected: true, selectionStart: 2, selectionEnd: 4, selectionDirection: 'backward', visible: true, inert: false, focused: 0,
    getClientRects() { return this.visible ? [{}] : []; }, closest() { return this.inert ? {} : null; },
    focus() { this.focused++; doc.activeElement = this; doc.dispatchEvent(new Event('focusin')); },
    setSelectionRange(start: number, end: number, direction: string) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  };
  const stop = preserveNativeKeyboardFocus(win as unknown as Window, doc as unknown as Document);
  const begin = () => { doc.activeElement = field; doc.dispatchEvent(new Event('focusin')); win.dispatchEvent(new Event('blur')); doc.activeElement = body; doc.dispatchEvent(new Event('focusout')); };
  const end = () => { win.dispatchEvent(new Event('focus')); for (const [id, fn] of [...frames]) { frames.delete(id); fn(0); } };
  return { doc, win, field, begin, end, stop };
}

test('installed Android restores the same field and selection after native window focus loss', () => {
  const f = fixture(); f.begin(); f.field.selectionStart = 0; f.field.selectionEnd = 0; f.end();
  assert.equal(f.doc.activeElement, f.field); assert.equal(f.field.focused, 1); assert.equal(f.field.selectionStart, 2); assert.equal(f.field.selectionEnd, 4); assert.equal(f.field.selectionDirection, 'backward'); f.stop();
});
test('normal field blur does not reopen the keyboard', () => {
  const f = fixture(); f.doc.activeElement = f.field; f.doc.dispatchEvent(new Event('focusin')); f.doc.activeElement = f.doc.body; f.doc.dispatchEvent(new Event('focusout')); f.end(); assert.equal(f.field.focused, 0); f.stop();
});
test('native input blur before window blur still preserves the recent field', () => {
  const f = fixture(); f.doc.activeElement = f.field; f.doc.dispatchEvent(new Event('focusin')); f.doc.activeElement = f.doc.body; f.doc.dispatchEvent(new Event('focusout')); f.win.dispatchEvent(new Event('blur')); f.end(); assert.equal(f.field.focused, 1); f.stop();
});
test('page taps, changed routes and focus moved to another control cancel restoration', () => {
  for (const action of ['tap', 'route', 'control', 'popstate', 'pagehide']) {
    const f = fixture(); f.begin();
    if (action === 'tap') f.doc.dispatchEvent(new Event('pointerdown'));
    if (action === 'route') f.win.location.href += '/other';
    if (action === 'control') f.doc.activeElement = { tagName: 'BUTTON' };
    if (action === 'popstate' || action === 'pagehide') f.win.dispatchEvent(new Event(action));
    f.end(); assert.equal(f.field.focused, 0, action); f.stop();
  }
});
test('disabled, read-only, removed, hidden and inert inputs never receive restored focus', () => {
  for (const change of ['disabled', 'readOnly', 'removed', 'hidden', 'inert']) {
    const f = fixture(); f.begin();
    if (change === 'disabled') f.field.disabled = true;
    if (change === 'readOnly') f.field.readOnly = true;
    if (change === 'removed') f.field.isConnected = false;
    if (change === 'hidden') f.field.visible = false;
    if (change === 'inert') f.field.inert = true;
    f.end(); assert.equal(f.field.focused, 0, change); f.stop();
  }
});
test('app switches longer than 30 seconds and desktop/browser sessions do not restore', () => {
  const original = Date.now;
  try { let now = 1000; Date.now = () => now; const f = fixture(); f.begin(); now += 31000; f.end(); assert.equal(f.field.focused, 0); f.stop(); } finally { Date.now = original; }
  for (const args of [[false, true], [true, false]]) { const f = fixture(...args); f.begin(); f.end(); assert.equal(f.field.focused, 0); f.stop(); }
});
test('visibility return restores once, while cleanup prevents subsequent callbacks', () => {
  const f = fixture(); f.doc.activeElement = f.field; f.doc.dispatchEvent(new Event('focusin')); f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); f.doc.activeElement = f.doc.body;
  f.win.dispatchEvent(new Event('focus')); assert.equal(f.field.focused, 0); f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange')); f.end(); assert.equal(f.field.focused, 1); f.begin(); f.stop(); f.end(); assert.equal(f.field.focused, 1);
});
test('both portals use identical keyboard focus protection', () => {
  assert.equal(readFileSync(new URL('../src/lib/nativeKeyboardFocus.ts', import.meta.url), 'utf8'), readFileSync(new URL('../../frontend/src/lib/nativeKeyboardFocus.ts', import.meta.url), 'utf8'));
});
