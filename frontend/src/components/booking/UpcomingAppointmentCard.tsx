import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale";
import { api } from "../../lib/api";
import { patientName } from "../../lib/patientPresentation";
import { formatSlotLabel } from "../../lib/slotLabel";
import { upcomingAppointment } from "../../lib/upcomingAppointment";
import type { MyAppointment } from "../../types";

export function UpcomingAppointmentCard() {
  useLanguage();
  const { user, loading } = useAuth();
  const query = useQuery({
    // Same account-scoped cache as MyAccount; existing logout cleanup removes it.
    queryKey: ["my-appointments", user?.id],
    queryFn: async ({ signal }) => (await api.get<{ data: MyAppointment[] }>("/patient/account/appointments", { signal })).data.data,
    enabled: Boolean(user) && !loading,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!user || loading || query.isError) return null;
  const appointment = upcomingAppointment(query.data ?? []);
  if (!appointment) return null;
  const reschedule = appointment.status === "RESCHEDULE_REQUIRED";
  return (
    <aside aria-label={t("موعدك القادم")} className="glass mb-4 flex flex-wrap items-center justify-between gap-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-primary-700"><CalendarDays className="h-4 w-4" aria-hidden="true" />{t("موعدك القادم")}</p>
        <p className="mt-1 break-words text-sm font-bold text-slate-900">{t("د. ")}{appointment.doctor.firstName} {appointment.doctor.lastName}</p>
        <p className="mt-0.5 text-xs text-slate-600">{formatSlotLabel(appointment.date, appointment.startTime)}</p>
        {appointment.beneficiary?.type === "FAMILY_MEMBER" && <p className="mt-1 text-xs text-primary-800">{t("الموعد لـ {0}", { "0": patientName(appointment.beneficiary) })}</p>}
        {reschedule && <p className="mt-1 text-xs font-semibold text-amber-800">{t("هذا الموعد يحتاج إلى إعادة جدولة")}</p>}
      </div>
      <Link to={reschedule ? `/account?appointment=${encodeURIComponent(appointment.id)}` : `/status/${encodeURIComponent(appointment.id)}`} className="btn-primary min-h-[44px] shrink-0 px-3 text-sm">
        {t(reschedule ? "تفاصيل الموعد" : "تتبّع دوري")}
      </Link>
    </aside>
  );
}
