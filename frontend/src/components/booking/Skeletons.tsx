// هياكل تحميل بسيطة (Skeleton) — حتى لا تبدو الصفحة فارغة أو متوقفة أثناء جلب البيانات.
export function SpecialtyGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="status" aria-live="polite" aria-label="جارٍ تحميل التخصصات">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl glass p-4">
          <div className="mx-auto h-11 w-11 rounded-full bg-slate-200" />
          <div className="mx-auto mt-3 h-3 w-3/4 rounded bg-slate-200" />
          <div className="mx-auto mt-2 h-2.5 w-1/2 rounded bg-slate-100" />
        </div>
      ))}
      <span className="sr-only">جارٍ تحميل التخصصات...</span>
    </div>
  );
}

export function DoctorListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-label="جارٍ تحميل الأطباء">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex animate-pulse gap-3 rounded-2xl glass p-4">
          <div className="h-14 w-14 shrink-0 rounded-full bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-slate-200" />
            <div className="h-3 w-1/2 rounded bg-slate-100" />
            <div className="h-3 w-3/4 rounded bg-slate-100" />
          </div>
        </div>
      ))}
      <span className="sr-only">جارٍ تحميل الأطباء...</span>
    </div>
  );
}

export function SlotSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl glass p-5" role="status" aria-live="polite">
      <div className="mx-auto h-3 w-1/3 rounded bg-slate-200" />
      <div className="mx-auto mt-3 h-5 w-2/3 rounded bg-slate-200" />
      <div className="mx-auto mt-3 h-8 w-1/3 rounded bg-slate-200" />
      <span className="sr-only">جارٍ تحديد أقرب موعد متاح...</span>
    </div>
  );
}
