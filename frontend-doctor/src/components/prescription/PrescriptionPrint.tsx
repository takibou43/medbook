import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import type { Doctor } from "../../types";
import type { PrescriptionMedication } from "../../lib/prescription";
import { formatDayAr } from "../../lib/doctorUi";

export interface PrescriptionSheetData {
  doctor: Doctor | null | undefined;
  patientName: string;
  relationship: string | null;
  /** YYYY-MM-DD بتوقيت الجزائر. */
  day: string;
  medications: PrescriptionMedication[];
  notes: string;
}

/** سطر بيانات يُطبع فقط إن كانت القيمة موجودة فعلًا (لا نخترع معلومات ناقصة). */
function Line({ value, className }: { value?: string | null; className?: string }) {
  const v = value?.trim();
  return v ? <p className={className}>{v}</p> : null;
}

/** ورقة الوصفة (A4) — نفس المكوّن في المعاينة والطباعة، فتطابق المعاينة ما يُطبع. */
export function PrescriptionSheet({ data }: { data: PrescriptionSheetData }) {
  const d = data.doctor;
  const clinic = d?.clinic ?? null;
  const place = [d?.city?.nameAr, d?.wilaya?.nameAr].filter(Boolean).join("، ");
  const address = clinic?.address || d?.address || null;
  const phone = clinic?.phone || d?.phone || null;
  return (
    <article className="rx-sheet" dir="rtl" lang="ar" aria-label="الوصفة الطبية">
      <header className="rx-head">
        <div className="rx-doctor">
          {d && <p className="rx-doctor-name">د. {d.firstName} {d.lastName}</p>}
          <Line value={d?.specialty?.nameAr} className="rx-muted" />
          <Line value={clinic?.nameAr} className="rx-strong" />
        </div>
        <div className="rx-contact">
          <Line value={address} />
          <Line value={place} />
          {phone && <p>الهاتف: <bdi dir="ltr">{phone}</bdi></p>}
        </div>
      </header>

      <h1 className="rx-title">وصفة طبية</h1>

      <section className="rx-meta">
        <p><span className="rx-label">اسم المريض:</span> <strong>{data.patientName}</strong>{data.relationship ? <span className="rx-muted"> ({data.relationship})</span> : null}</p>
        <p><span className="rx-label">التاريخ:</span> {formatDayAr(data.day)}</p>
      </section>

      <table className="rx-table">
        <thead>
          <tr>
            <th scope="col" className="rx-num">#</th>
            <th scope="col">الدواء</th>
            <th scope="col">الجرعة</th>
            <th scope="col">عدد مرات الاستخدام</th>
            <th scope="col">مدة العلاج</th>
          </tr>
        </thead>
        <tbody>
          {data.medications.map((m, i) => (
            <tr key={m.id}>
              <td className="rx-num">{i + 1}</td>
              <td>
                <strong className="rx-med">{m.name}</strong>
                {m.instructions.trim() && <span className="rx-instr">{m.instructions.trim()}</span>}
              </td>
              <td>{m.dose.trim() || "—"}</td>
              <td>{m.frequency.trim() || "—"}</td>
              <td>{m.duration.trim() || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.notes.trim() && (
        <section className="rx-notes">
          <p className="rx-label">ملاحظات:</p>
          <p className="rx-notes-body">{data.notes.trim()}</p>
        </section>
      )}

      <footer className="rx-sign">
        <div className="rx-sign-box">
          <p className="rx-label">توقيع الطبيب</p>
        </div>
        <div className="rx-sign-box">
          <p className="rx-label">الختم</p>
        </div>
      </footer>
    </article>
  );
}

/**
 * معاينة الوصفة قبل الطباعة. الطباعة تُخفي كل الصفحة عدا الورقة (انظر .rx-print-root في index.css)،
 * ولا تغيّر حالة أي موعد ولا ترسل أي شيء.
 */
export function PrescriptionPreview({ open, data, onClose }: { open: boolean; data: PrescriptionSheetData | null; onClose: () => void }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add("rx-printing");
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const els = Array.from(ref.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("rx-printing");
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, onClose]);

  if (!open || !data) return null;

  return createPortal(
    <div className="rx-print-root fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-3 sm:p-6">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="mx-auto max-w-[210mm] outline-none">
        <div className="rx-no-print sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 shadow-lg">
          <div>
            <h2 id={titleId} className="text-base font-bold text-slate-900">معاينة الوصفة</h2>
            <p className="text-xs text-slate-500">هذه هي الورقة كما ستُطبع على A4. الطباعة لا تغيّر حالة الموعد ولا ترسل شيئًا للمريض.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="btn-primary">
              <Printer className="h-4 w-4" aria-hidden="true" /> طباعة
            </button>
            <button type="button" onClick={onClose} className="btn-outline">
              <X className="h-4 w-4" aria-hidden="true" /> رجوع للتعديل
            </button>
          </div>
        </div>
        <div className="rx-paper">
          <PrescriptionSheet data={data} />
        </div>
      </div>
    </div>,
    document.body
  );
}
