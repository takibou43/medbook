import { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import clsx from "clsx";

// بطاقة إحصائية مدمجة: أيقونة صغيرة في دائرة، ثم الرقم كبيرًا، ثم العنوان، ثم سطر
// توضيحي اختياري. نستخدم صنف .card مباشرة (لا مكوّن Card) لأن Card يفرض p-5 ولا يمكن
// تجاوزه بثقة عبر clsx — والهدف هنا حشو أقل لتقليل التمرير على الهاتف.
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "primary",
  to,
}: {
  label: string;
  value: number | string;
  /** سطر توضيحي قصير تحت العنوان (اختياري). */
  sub?: string;
  icon: LucideIcon;
  tone?: "primary" | "green" | "red" | "amber";
  to?: string;
}) {
  const tones = {
    primary: "bg-primary-100 text-primary-700",
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
  };

  const card = (
    <div
      className={clsx(
        // على الهاتف: الأيقونة فوق والرقم تحتها بعرض البطاقة كاملًا حتى لا يُقصّ رقم طويل
        // في عمودين ضيّقين. من sm وأعلى: الأيقونة بجانب الرقم كما في التصميم الحالي.
        "card flex h-full flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-3 sm:p-4",
        to && "transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md"
      )}
    >
      <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">{value}</p>
        <p className="truncate text-xs font-medium text-slate-600 sm:text-sm">{label}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] leading-4 text-slate-500">{sub}</p>}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block h-full">
        {card}
      </Link>
    );
  }
  return card;
}
