import { useLanguage } from "../i18n/LanguageRoot";
import { t, getLanguage } from "../i18n/locale.ts";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarPlus } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api, apiErrorMessage } from "../lib/api";
import { addMonthsDay, algeriaDay } from "../lib/features";

export interface FollowUpContext {
  hasAccount?: boolean;
  /** الموعد الأصلي (لنفس الطبيب ولمريض بحساب) — مرجع العلاقة العلاجية. */
  parentAppointmentId: string;
  /** اسم المستفيد في الموعد الأصلي كما يُعرض. */
  beneficiaryName: string;
  /** إن كان المستفيد فردًا من العائلة: اسم صاحب الحساب لخيار «صاحب الحساب» الصريح. */
  familyMemberId?: string | null;
  accountHolderName?: string | null;
  /** ربط اختياري بخطة علاج الأسنان. */
  treatmentPlanId?: string;
  treatmentSessionId?: string;
  dentalFollowUpId?: string;
  /** تاريخ مقترح (مثل تاريخ المتابعة المستحقة). */
  suggestedDate?: string;
}

/**
 * نافذة «برمجة موعد عودة»: المستفيد ظاهر بوضوح، الأوقات المتاحة فقط (من الخادم)، ملخص قبل التأكيد.
 * مفتاح منع التكرار يتولّد مرة لكل فتح للنافذة: الضغط المزدوج أو إعادة الإرسال لا ينشئ موعدين.
 * بلا رسائل هاتفية: المريض يُشعَر داخل MedBook فقط.
 */
export function FollowUpModal({ open, onClose, ctx, onDone }: { open: boolean; onClose: () => void; ctx: FollowUpContext | null; onDone?: () => void }) {
  useLanguage();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [time, setTime] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [forAccountHolder, setForAccountHolder] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => (open ? crypto.randomUUID() : ""), [open, ctx?.parentAppointmentId, getLanguage()]);

  useEffect(() => {
    if (!open) return;
    setDate(ctx?.suggestedDate && ctx.suggestedDate >= algeriaDay() ? ctx.suggestedDate : algeriaDay(1));
    setTime(null);
    setNotes("");
    setForAccountHolder(false);
    setConfirming(false);
    setError(null);
  }, [open, ctx?.parentAppointmentId, ctx?.suggestedDate]);

  const slots = useQuery({
    queryKey: ["follow-up-slots", date],
    queryFn: async () => (await api.get<{ data: { slots: string[]; slotMinutes: number } }>("/doctor/follow-up-slots", { params: { date } })).data.data,
    enabled: open && /^\d{4}-\d{2}-\d{2}$/.test(date),
    retry: false,
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/doctor/appointments/${ctx!.parentAppointmentId}/follow-up`, {
          date,
          startTime: time,
          notes: notes.trim() || undefined,
          // null صريح = صاحب الحساب؛ غياب الحقل = نفس مستفيد الموعد الأصلي.
          ...(forAccountHolder ? { familyMemberId: null } : {}),
          ...(ctx?.treatmentPlanId ? { treatmentPlanId: ctx.treatmentPlanId } : {}),
          ...(ctx?.treatmentSessionId ? { treatmentSessionId: ctx.treatmentSessionId } : {}),
          ...(ctx?.dentalFollowUpId ? { dentalFollowUpId: ctx.dentalFollowUpId } : {}),
          idempotencyKey,
        })
      ).data,
    onSuccess: () => {
      showToast(t(ctx?.hasAccount === false ? "تمت برمجة موعد العودة للمريض دون حساب." : "تمت برمجة موعد العودة وإشعار المريض داخل MedBook."), "success");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["treatment-plan"] });
      qc.invalidateQueries({ queryKey: ["treatment-plans"] });
      qc.invalidateQueries({ queryKey: ["doctor-patients"] });
      onDone?.();
      onClose();
    },
    onError: (e: any) => {
      if (e?.response?.status === 409) {
        setTime(null);
        setConfirming(false);
        qc.invalidateQueries({ queryKey: ["follow-up-slots", date] });
      }
      setError(apiErrorMessage(e, t("تعذّرت برمجة الموعد.")));
    },
  });

  if (!ctx) return null;
  const who = forAccountHolder && ctx.accountHolderName ? ctx.accountHolderName : ctx.beneficiaryName;

  return (
    <Modal open={open} onClose={onClose} title={t("برمجة موعد عودة")}>
      <div className="space-y-4 text-start">
        <div className="rounded-xl bg-primary-50 p-3 text-sm">
          <p className="text-slate-600">{t("المستفيد")}</p>
          <p className="text-base font-bold text-primary-900">{who}</p>
          {ctx.familyMemberId && ctx.accountHolderName && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={forAccountHolder} onChange={(e) => { setForAccountHolder(e.target.checked); setConfirming(false); }} />{t("الموعد لصاحب الحساب (")}{ctx.accountHolderName}{t(") بدل فرد العائلة ")}</label>
          )}
        </div>

        {!confirming ? (
          <>
            <div>
              <label className="label" htmlFor="fu-date">{t("التاريخ")}</label>
              <input
                id="fu-date"
                type="date"
                dir="ltr"
                className="input"
                min={algeriaDay()}
                value={date}
                onChange={(e) => { setDate(e.target.value); setTime(null); setError(null); }}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {[1, 3, 6].map((m) => (
                  <button key={m} type="button" className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-primary-400" onClick={() => { setDate(addMonthsDay(algeriaDay(), m)); setTime(null); }}>{t("بعد ")}{m === 1 ? t("شهر") : t("{0} أشهر", { "0": m })}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="label">{t("الأوقات المتاحة")}</p>
              {slots.isLoading ? (
                <p className="text-sm text-slate-500">{t("جارٍ تحميل الأوقات...")}</p>
              ) : slots.isError ? (
                <p className="text-sm text-red-600" role="alert">{apiErrorMessage(slots.error, t("تعذّر تحميل الأوقات."))}</p>
              ) : (slots.data?.slots.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-500">{t("لا توجد أوقات متاحة في هذا اليوم (عطلة أو خارج الدوام أو محجوز بالكامل). اختر يومًا آخر.")}</p>
              ) : (
                <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5" dir="ltr">
                  {slots.data!.slots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setTime(s); setError(null); }}
                      className={clsx("min-h-[40px] rounded-lg border text-sm font-semibold", time === s ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-primary-400")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="label" htmlFor="fu-notes">{t("سبب العودة أو ملاحظة (اختياري)")}</label>
              <textarea id="fu-notes" className="input min-h-[70px]" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </>
        ) : (
          <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4 py-1 text-sm">
            <div className="flex justify-between py-2"><dt className="text-slate-500">{t("المستفيد")}</dt><dd className="font-semibold">{who}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-500">{t("التاريخ")}</dt><dd className="font-semibold" dir="ltr">{date}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-500">{t("الوقت")}</dt><dd className="font-semibold" dir="ltr">{time}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-500">{t("النوع")}</dt><dd className="font-semibold">{t("موعد عودة (مؤكَّد مباشرة)")}</dd></div>
            {notes.trim() && <div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">{t("ملاحظة")}</dt><dd className="break-words">{notes.trim()}</dd></div>}
          </dl>
        )}

        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t(error ?? "")}</p>}

        <div className="flex gap-2">
          {!confirming ? (
            <Button type="button" className="flex-1" disabled={!time} onClick={() => setConfirming(true)}>
              <CalendarPlus className="h-4 w-4" />{t(" مراجعة ")}</Button>
          ) : (
            <>
              <Button type="button" className="flex-1" loading={create.isPending} onClick={() => create.mutate()}>{t("تأكيد موعد العودة ")}</Button>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={create.isPending}>{t("تعديل ")}</Button>
            </>
          )}
        </div>
        <p className="text-xs text-slate-500">{t(ctx?.hasAccount === false ? "يُحفظ الموعد بالاسم واللقب والهاتف. أخبر المريض بتفاصيله من العيادة." : "سيُشعَر المريض داخل MedBook، ويستطيع إلغاء الموعد من حسابه.")}</p>
      </div>
    </Modal>
  );
}
