import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE = 'summary, a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useLanguage();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) onClose();
      // حصر Tab داخل النافذة حتى لا ينتقل التركيز إلى الصفحة خلفها.
      if (e.key === "Tab" && dialogRef.current) {
        const els = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
          if (!el.getClientRects().length || el.closest("[inert]") || getComputedStyle(el).visibility === "hidden") return false;
          // Chromium may return rectangles for descendants of closed details.
          for (let parent = el.parentElement; parent && parent !== dialogRef.current; parent = parent.parentElement) {
            if (parent.tagName === "DETAILS" && !parent.hasAttribute("open") && !parent.querySelector(":scope > summary")?.contains(el)) return false;
          }
          return true;
        });
        if (els.length === 0) { e.preventDefault(); return; }
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        if (!dialogRef.current.contains(active)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // عند الفتح: التركيز على النافذة نفسها (يُقرأ عنوانها). عند الإغلاق: يعود إلى العنصر الذي كان مركَّزًا
  // إن بقي في الصفحة (الصفحات التي تحتاج وجهة أخرى تتولاها بنفسها).
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1} className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl outline-none">
        <div className="mb-4 flex items-center justify-between">
          {title && <h3 id={titleId} className="text-lg font-bold text-slate-900">{t(title ?? "")}</h3>}
          <button type="button" aria-label={t("إغلاق")} title={t("إغلاق النافذة")} onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-primary-400">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
