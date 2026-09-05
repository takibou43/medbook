import { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "./ui/Card";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
  to,
}: {
  label: string;
  value: number | string;
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
    <Card className={`flex items-center gap-4 ${to ? "cursor-pointer transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md" : ""}`}>
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tones[tone]}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-2xl font-extrabold text-slate-900">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </Card>
  );

  if (to) {
    return (
      <Link to={to} className="block">
        {card}
      </Link>
    );
  }
  return card;
}
