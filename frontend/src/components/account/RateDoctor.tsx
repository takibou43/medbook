import { useState } from "react";
import { Star, X } from "lucide-react";
import clsx from "clsx";
import { api, apiErrorMessage } from "../../lib/api";
import { Button } from "../ui/Button";
import type { MyAppointment } from "../../types";

// تقييم الطبيب بعد اكتمال الموعد — يستعمل POST /api/reviews الموجود (مرة واحدة لكل موعد، COMPLETED فقط).
// الطبيب يُشتق في الخادم من الموعد نفسه، فلا نرسل إلا appointmentId والنجوم والتعليق الاختياري.

export const COMMENT_MAX = 1000;
const LABELS = ["", "سيئ", "مقبول", "جيد", "جيد جدًا", "ممتاز"];

export function canRate(a: MyAppointment): boolean {
  return a.status === "COMPLETED" && !a.review;
}

/** نجوم قابلة للاختيار: أزرار كبيرة مناسبة للمس، وتعمل كمجموعة اختيار (radiogroup) لقارئ الشاشة. */
export function StarInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="عدد النجوم">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} من 5 — ${LABELS[n]}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          className="flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-amber-50 disabled:opacity-60"
        >
          <Star className={clsx("h-8 w-8", n <= value ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-300")} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function StarsDisplay({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} من 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={clsx(size, n <= value ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200")} aria-hidden="true" />
      ))}
    </span>
  );
}

export function RateDoctorForm({ appointment, onDone, onCancel }: { appointment: MyAppointment; onDone: () => void; onCancel?: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const text = comment.trim();
      await api.post("/reviews", { appointmentId: appointment.id, rating, comment: text ? text : undefined });
      onDone();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // 409 = قُيِّم من قبل (نافذة أخرى مثلًا): نحدّث القائمة فيظهر التقييم المحفوظ بدل الخطأ.
      if (status === 409) onDone();
      else setError(apiErrorMessage(err, "تعذّر حفظ التقييم. حاول مجددًا."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <StarInput value={rating} onChange={setRating} disabled={submitting} />
        <p className="mt-1 h-4 text-xs font-semibold text-amber-700">{rating > 0 ? LABELS[rating] : ""}</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-600">تعليق (اختياري)</span>
        <textarea
          className="input min-h-[72px] resize-y"
          maxLength={COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="شاركنا تجربتك مع الطبيب..."
          disabled={submitting}
        />
        <span className="mt-0.5 block text-left text-[11px] text-slate-400" dir="ltr">
          {comment.length}/{COMMENT_MAX}
        </span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={submit} loading={submitting} disabled={rating < 1} className="min-h-[44px] flex-1 sm:flex-none">
          إرسال التقييم
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="min-h-[44px]">
            لاحقًا
          </Button>
        )}
      </div>
      <p className="text-[11px] text-slate-500">يمكن تقييم كل موعد مرة واحدة فقط، ولا يمكن تعديل التقييم بعد إرساله.</p>
    </div>
  );
}

/**
 * بطاقة «كيف تقيّم الطبيب؟» أعلى صفحة الحساب لآخر موعد مكتمل غير مقيَّم. غير معطِّلة: يمكن إخفاؤها
 * («لاحقًا» أو ×) ويبقى خيار التقييم ظاهرًا في «المواعيد السابقة».
 */
export function RatePrompt({ appointment, onDone, onDismiss }: { appointment: MyAppointment; onDone: () => void; onDismiss: () => void }) {
  return (
    <section className="glass border-amber-200 p-4 ring-1 ring-amber-200" aria-label="تقييم الطبيب">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">كيف تقيّم الطبيب؟</h2>
          <p className="text-sm text-slate-600">
            موعدك مع د. {appointment.doctor.firstName} {appointment.doctor.lastName} اكتمل.
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="إخفاء">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3">
        <RateDoctorForm appointment={appointment} onDone={onDone} onCancel={onDismiss} />
      </div>
    </section>
  );
}

// «لاحقًا» يُخفي البطاقة العلوية لهذا الموعد على هذا الجهاز فقط — التقييم يبقى متاحًا في السجل.
const DISMISSED_KEY = "mb-rate-dismissed";
export function readDismissed(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function saveDismissed(ids: string[]) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-100)));
  } catch {
    /* التخزين غير متاح — الإخفاء يبقى لهذه الجلسة فقط */
  }
}
