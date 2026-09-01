import { Search, Stethoscope, CalendarCheck, ShieldCheck } from "lucide-react";

const PATIENT_STEPS = [
  "يدخل المريض إلى الموقع ويبحث عن طبيب أو تخصص.",
  "يختار الولاية والتخصص المناسبَين.",
  "يشاهد قائمة الأطباء ويدخل إلى ملف الطبيب المطلوب.",
  "يشاهد المواعيد المتاحة ويحجز موعدًا.",
  "تصله رسالة تأكيد داخل التطبيق.",
  "يدخل إلى حسابه ويتابع حالة موعده.",
];

const DOCTOR_STEPS = [
  "يدخل الطبيب إلى حسابه بعد التحقق من طرف الإدارة.",
  "يدير ملفه المهني ومعلوماته.",
  "يحدد أوقات عمله الأسبوعية والاستثناءات.",
  "يشاهد طلبات الحجز الجديدة.",
  "يؤكد أو يلغي الموعد.",
  "يدير قائمة مرضاه ومواعيدهم.",
];

export default function HowItWorks() {
  return (
    <div className="container-app py-10">
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">كيف يعمل MedBook؟</h1>
      <p className="mb-10 text-slate-600">خطوات بسيطة تفصلك عن حجز موعدك الطبي القادم.</p>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="card p-6">
          <div className="mb-4 flex items-center gap-2 text-primary-700">
            <Search className="h-5 w-5" />
            <h2 className="font-bold">للمريض</h2>
          </div>
          <ol className="space-y-3">
            {PATIENT_STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-600">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-center gap-2 text-primary-700">
            <Stethoscope className="h-5 w-5" />
            <h2 className="font-bold">للطبيب</h2>
          </div>
          <ol className="space-y-3">
            {DOCTOR_STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-600">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3 rounded-2xl bg-primary-50 p-5 text-primary-800">
        <ShieldCheck className="h-6 w-6 shrink-0" />
        <p className="text-sm">جميع الأطباء على المنصة يخضعون للتحقق من طرف الإدارة قبل ظهورهم في نتائج البحث.</p>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-5 text-slate-600">
        <CalendarCheck className="h-6 w-6 shrink-0" />
        <p className="text-sm">يمنع النظام تلقائيًا حجز فترتين في نفس الوقت لنفس الطبيب (Double Booking).</p>
      </div>
    </div>
  );
}
