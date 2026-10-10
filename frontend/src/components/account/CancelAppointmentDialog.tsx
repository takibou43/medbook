import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import type { MyAppointment } from "../../types";
import { arabicDate, patientName } from "../../lib/patientPresentation";
import { useDialogFocus } from "../booking/useDialogFocus";

export function CancelAppointmentDialog({ appointment, busy, onClose, onConfirm }: {
  appointment: MyAppointment; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  useLanguage();
  const ref = useDialogFocus(() => { if (!busy) onClose(); });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="cancel-title" aria-describedby="cancel-details" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
      <h2 id="cancel-title" className="text-lg font-bold">{t("تأكيد إلغاء الموعد")}</h2>
      <div id="cancel-details" className="mt-3 space-y-2 text-sm text-slate-700">
        <p>{t("المستفيد: ")}<strong>{patientName(appointment.beneficiary)}</strong></p>
        <p>{t("الطبيب: د. ")}{appointment.doctor.firstName} {appointment.doctor.lastName}</p>
        <p>{t("التاريخ: ")}{arabicDate(appointment.date)}{t("، الساعة ")}<bdi>{appointment.startTime}</bdi></p>
        <p>{t("هل تريد إلغاء هذا الموعد؟")}</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className="btn-outline flex-1" onClick={onClose} disabled={busy}>{t("الاحتفاظ بالموعد")}</button>
        <button type="button" className="btn-danger flex-1" onClick={onConfirm} disabled={busy}>{busy ? t("جارٍ الإلغاء…") : t("نعم، إلغاء الموعد")}</button>
      </div>
    </div>
  </div>;
}
