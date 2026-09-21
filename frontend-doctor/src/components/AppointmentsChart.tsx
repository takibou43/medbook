import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api, apiErrorMessage } from "../lib/api";
import { Spinner, ErrorState } from "./ui/States";

type Range = "7d" | "30d" | "this_month" | "last_month";
const RANGES: { key: Range; label: string }[] = [
  { key: "7d", label: "آخر 7 أيام" },
  { key: "30d", label: "آخر 30 يومًا" },
  { key: "this_month", label: "هذا الشهر" },
  { key: "last_month", label: "الشهر الماضي" },
];

interface Point {
  date: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

const W = 640;
const H = 220;
const PAD = { l: 34, r: 12, t: 12, b: 26 };

/** مخطط خطي/مساحي بـSVG خالص (لا مكتبة رسوم في المشروع ولم نضف واحدة). المحور الزمني من اليسار لليمين. */
export function AppointmentsChart() {
  const [range, setRange] = useState<Range>("7d");
  const [hover, setHover] = useState<number | null>(null);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["admin-series", range],
    queryFn: async () => (await api.get("/admin/stats/series", { params: { range } })).data.data as { total: number; points: Point[] },
  });

  const geo = useMemo(() => {
    const pts = data?.points ?? [];
    const max = Math.max(1, ...pts.map((p) => p.total));
    const niceMax = max <= 4 ? max : Math.ceil(max / 4) * 4;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (i: number) => PAD.l + (pts.length <= 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
    const y = (v: number) => PAD.t + ih - (v / niceMax) * ih;
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
    const area = pts.length ? `${line} L${x(pts.length - 1).toFixed(1)},${PAD.t + ih} L${x(0).toFixed(1)},${PAD.t + ih} Z` : "";
    const ticks = Array.from({ length: 5 }, (_, i) => Math.round((niceMax / 4) * i * 100) / 100).filter((v, i, a) => a.indexOf(v) === i);
    return { pts, x, y, line, area, ticks, iw };
  }, [data]);

  const active = hover !== null ? geo.pts[hover] : null;
  const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("ar-DZ", { day: "numeric", month: "short", timeZone: "UTC" });
  const labelEvery = Math.max(1, Math.ceil(geo.pts.length / 8));

  return (
    <div className="card space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-800">المواعيد حسب اليوم</h2>
          <p className="text-xs text-slate-500">
            حسب تاريخ الموعد{data ? ` — المجموع في الفترة: ${data.total}` : ""}
            {isFetching && !isLoading ? " · يتم التحديث…" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={range === r.key}
              onClick={() => {
                setRange(r.key);
                setHover(null);
              }}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                range === r.key ? "bg-white text-primary-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} />
      ) : data && data.total === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">لا توجد مواعيد في هذه الفترة</div>
      ) : (
        <div className="relative" dir="ltr">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label="مخطط عدد المواعيد اليومية"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              let best = 0;
              geo.pts.forEach((_, i) => {
                if (Math.abs(geo.x(i) - px) < Math.abs(geo.x(best) - px)) best = i;
              });
              setHover(best);
            }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((t.clientX - r.left) / r.width) * W;
              let best = 0;
              geo.pts.forEach((_, i) => {
                if (Math.abs(geo.x(i) - px) < Math.abs(geo.x(best) - px)) best = i;
              });
              setHover(best);
            }}
          >
            <defs>
              <linearGradient id="apptFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
            </defs>
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="#e2e8f0" strokeDasharray="3 3" />
                <text x={PAD.l - 6} y={geo.y(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
                  {t}
                </text>
              </g>
            ))}
            <path d={geo.area} fill="url(#apptFill)" />
            <path d={geo.line} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {geo.pts.map((p, i) => (
              <g key={p.date}>
                {i % labelEvery === 0 && (
                  <text x={geo.x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">
                    {fmt(p.date)}
                  </text>
                )}
                <circle cx={geo.x(i)} cy={geo.y(p.total)} r={hover === i ? 5 : geo.pts.length > 31 ? 0 : 3} fill="#fff" stroke="#2563eb" strokeWidth="2" />
              </g>
            ))}
            {hover !== null && <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#93c5fd" strokeDasharray="4 3" />}
          </svg>

          {active && (
            <div
              dir="rtl"
              className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-lg"
              style={{ left: `${Math.min(88, Math.max(12, (geo.x(hover!) / W) * 100))}%` }}
            >
              <p className="mb-1 font-bold text-slate-800">{fmt(active.date)}</p>
              <p className="flex justify-between text-slate-600"><span>إجمالي</span><b>{active.total}</b></p>
              <p className="flex justify-between text-green-700"><span>مكتملة</span><b>{active.completed}</b></p>
              <p className="flex justify-between text-red-600"><span>ملغاة</span><b>{active.cancelled}</b></p>
              <p className="flex justify-between text-amber-700"><span>لم يحضر</span><b>{active.noShow}</b></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
