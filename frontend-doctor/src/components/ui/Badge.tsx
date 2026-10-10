import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { ReactNode } from "react";
import clsx from "clsx";
import { AppointmentStatus, VerificationStatus, SubscriptionStatus, InviteStatus } from "../../types";

const APPT_LABELS: Record<AppointmentStatus, { label: string; className: string }> = {
  PENDING: { label: "بانتظار التأكيد", className: "bg-amber-100 text-amber-700" },
  CONFIRMED: { label: "مؤكد", className: "bg-blue-100 text-blue-700" },
  RESCHEDULE_REQUIRED: { label: "يحتاج إعادة جدولة", className: "bg-red-100 text-red-700" },
  IN_PROGRESS: { label: "بالداخل الآن", className: "bg-primary-100 text-primary-700" },
  LATE: { label: "متأخر", className: "bg-amber-100 text-amber-700" },
  COMPLETED: { label: "مكتمل", className: "bg-green-100 text-green-700" },
  CANCELLED: { label: "ملغى", className: "bg-red-100 text-red-700" },
  NO_SHOW: { label: "لم يحضر", className: "bg-slate-200 text-slate-600" },
};

const VERIFY_LABELS: Record<VerificationStatus, { label: string; className: string }> = {
  PENDING: { label: "قيد المراجعة", className: "bg-amber-100 text-amber-700" },
  VERIFIED: { label: "موثّق", className: "bg-green-100 text-green-700" },
  REJECTED: { label: "مرفوض", className: "bg-red-100 text-red-700" },
};

const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, { label: string; className: string }> = {
  ACTIVE: { label: "الاشتراك فعّال", className: "bg-green-100 text-green-700" },
  UNPAID: { label: "غير مفعّل", className: "bg-amber-100 text-amber-700" },
  EXPIRED: { label: "منتهي", className: "bg-red-100 text-red-700" },
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  useLanguage();
  const { label, className } = APPT_LABELS[status];
  return <span className={clsx("badge", className)}>{t(label ?? "")}</span>;
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  useLanguage();
  const { label, className } = VERIFY_LABELS[status];
  return <span className={clsx("badge", className)}>{t(label ?? "")}</span>;
}

export function SubscriptionBadge({ status }: { status: SubscriptionStatus }) {
  useLanguage();
  const { label, className } = SUBSCRIPTION_LABELS[status];
  return <span className={clsx("badge", className)}>{t(label ?? "")}</span>;
}

const INVITE_LABELS: Record<InviteStatus, { label: string; className: string }> = {
  PENDING: { label: "بانتظار القبول", className: "bg-amber-100 text-amber-700" },
  ACCEPTED: { label: "تم القبول", className: "bg-green-100 text-green-700" },
  REVOKED: { label: "ملغاة", className: "bg-slate-200 text-slate-600" },
  EXPIRED: { label: "منتهية الصلاحية", className: "bg-red-100 text-red-700" },
};

export function InviteStatusBadge({ status }: { status: InviteStatus }) {
  useLanguage();
  const { label, className } = INVITE_LABELS[status];
  return <span className={clsx("badge", className)}>{t(label ?? "")}</span>;
}

export function AssistantActiveBadge({ isActive }: { isActive: boolean }) {
  useLanguage();
  return (
    <span className={clsx("badge", isActive ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600")}>
      {isActive ? t("نشط") : t("معطّل")}
    </span>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  useLanguage();
  return <span className={clsx("badge bg-slate-100 text-slate-700", className)}>{children}</span>;
}
