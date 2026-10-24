import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useNextSlot } from "../../hooks/useNextSlot";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale";
import { isUpcomingSlot, nextSlotErrorKind } from "../../lib/nextSlot";
import { formatSlotLabel } from "../../lib/slotLabel";

export function NextSlotPreview({ doctorId }: { doctorId: string }) {
  useLanguage();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const preview = useNextSlot(doctorId, visible);
  const slot = preview.data;
  const available = !preview.isError && isUpcomingSlot(slot);
  const errorKind = nextSlotErrorKind(preview.error);
  return (
    <span ref={ref} className="block min-h-[44px] min-w-0 text-start" aria-live="polite">
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("أقرب موعد متاح")}
      </span>
      <span className={`mt-1 block text-sm font-bold ${available ? "text-primary-700" : "text-slate-500"}`}>
        {available ? formatSlotLabel(slot.date, slot.startTime)
          : preview.isError ? errorKind === "noSlots" ? t("لا توجد مواعيد متاحة حاليًا لدى هذا الطبيب.")
            : errorKind === "unavailable" ? t("هذا الطبيب لم يعد متاحًا حاليًا.")
            : t("تعذّر التحقق من التوفر. افتح الحجز للمحاولة مجددًا.")
          : preview.isFetching ? t("جارٍ التحقق من التوفر...")
          : t("افتح الحجز للتحقق من أقرب موعد.")}
      </span>
    </span>
  );
}
