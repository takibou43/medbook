import type { ReactNode } from "react";
import { Bell } from "lucide-react";
import { t } from "../i18n/locale";

/** The same request stays visible in the board when its dialog is dismissed. */
export function AdmissionRequestCard({ doctorName, patientName, turn, children }: {
  doctorName: string; patientName?: string; turn?: string; children: ReactNode;
}) {
  return <section className="admission-request rounded-2xl border border-primary-200 bg-white/95 p-4">
    <div className="flex items-center gap-2 text-primary-800">
      <Bell className="h-5 w-5 shrink-0" aria-hidden="true" />
      <h3 className="break-words text-lg font-bold">{doctorName}</h3>
    </div>
    <p className="mt-1 text-sm text-slate-700">{t("يطلب إدخال المريض التالي")}</p>
    {patientName ? <>
      <p className="mt-3 break-words text-xl font-extrabold text-slate-900">{patientName}</p>
      {turn && <p className="mb-3 mt-1 text-sm text-slate-700">{t("رقم الدور")} <bdi className="font-bold tabular-nums">{turn}</bdi></p>}
    </> : <p className="my-3 text-sm text-amber-800">{t("لا يوجد مريض حاضر جاهز للإدخال. سجّل الحضور من الطابور أولًا.")}</p>}
    <div className="mt-3">{children}</div>
  </section>;
}
