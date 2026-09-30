import { Link } from "react-router-dom";
import clsx from "clsx";
import { UserRound, Users } from "lucide-react";
import type { FamilyMember } from "../../types";
import { RELATIONSHIP_LABELS, memberFullName } from "../../lib/family";

interface Props {
  members: FamilyMember[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** null = الموعد لي، وإلا معرّف فرد العائلة. */
  value: string | null;
  /** «لفرد من العائلة» مختار لكن لم يُحدَّد الفرد بعد. */
  familyMode: boolean;
  onChange: (next: { familyMode: boolean; memberId: string | null }) => void;
}

/**
 * «الموعد لي» / «الموعد لفرد من العائلة». القائمة تأتي من الخادم وتبقى في الذاكرة فقط.
 * الخادم يتحقق من ملكية الفرد ويأخذ اسمه من قاعدة البيانات؛ هنا عرض واختيار فقط.
 */
export function BeneficiaryPicker({ members, loading, error, onRetry, value, familyMode, onChange }: Props) {
  const option = (active: boolean) =>
    clsx(
      "flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
      active ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-primary-400"
    );

  return (
    <fieldset className="space-y-3">
      <legend className="label">لمن هذا الموعد؟</legend>
      <div className="flex gap-2" role="radiogroup">
        <button type="button" role="radio" aria-checked={!familyMode} className={option(!familyMode)} onClick={() => onChange({ familyMode: false, memberId: null })}>
          <UserRound className="h-4 w-4" aria-hidden="true" /> الموعد لي
        </button>
        <button type="button" role="radio" aria-checked={familyMode} className={option(familyMode)} onClick={() => onChange({ familyMode: true, memberId: value })}>
          <Users className="h-4 w-4" aria-hidden="true" /> لفرد من العائلة
        </button>
      </div>

      {familyMode && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          {loading ? (
            <p className="text-sm text-slate-500">جارٍ تحميل أفراد العائلة...</p>
          ) : error ? (
            <p className="text-sm text-red-600" role="alert">
              تعذّر تحميل أفراد العائلة.{" "}
              <button type="button" className="font-semibold underline" onClick={onRetry}>
                إعادة المحاولة
              </button>
            </p>
          ) : members.length === 0 ? (
            <p className="text-sm text-slate-600">
              لم تُضف أي فرد بعد.{" "}
              <Link to="/account/family" className="font-semibold text-primary-700 hover:underline">
                أضف فردًا من العائلة
              </Link>
            </p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id}>
                  <label
                    className={clsx(
                      "flex min-h-[48px] cursor-pointer items-center justify-between gap-3 rounded-lg border bg-white px-3",
                      value === m.id ? "border-primary-600 ring-1 ring-primary-600" : "border-slate-200"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="beneficiary"
                        className="h-4 w-4 accent-primary-600"
                        checked={value === m.id}
                        onChange={() => onChange({ familyMode: true, memberId: m.id })}
                      />
                      <span className="font-semibold text-slate-800">{memberFullName(m)}</span>
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{RELATIONSHIP_LABELS[m.relationship]}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  );
}
