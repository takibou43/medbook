import { ReactNode } from "react";
import clsx from "clsx";
import { AppointmentStatus, VerificationStatus, SubscriptionStatus } from "../../types";

const APPT_LABELS: Record<AppointmentStatus, { label: string; className: string }> = {
  PENDING: { label: "بانتظار التأكيد", className: "bg-amber-100 text-amber-700" },
  CONFIRMED: { label: "مؤكد", className: "bg-blue-100 text-blue-700" },
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
  const { label, className } = APPT_LABELS[status];
  return <span className={clsx("badge", className)}>{label}</span>;
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { label, className } = VERIFY_LABELS[status];
  return <span className={clsx("badge", className)}>{label}</span>;
}

export function SubscriptionBadge({ status }: { status: SubscriptionStatus }) {
  const { label, className } = SUBSCRIPTION_LABELS[status];
  return <span className={clsx("badge", className)}>{label}</span>;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("badge bg-slate-100 text-slate-700", className)}>{children}</span>;
}
