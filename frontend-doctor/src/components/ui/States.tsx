import { Loader2, Inbox, AlertTriangle, RefreshCw } from "lucide-react";

export function Spinner({ label = "جارٍ التحميل..." }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-2 py-16 text-slate-600">
      <Loader2 className="h-8 w-8 animate-spin text-primary-500" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** هيكل تحميل بنفس ارتفاع المحتوى تقريبًا حتى لا «تقفز» الصفحة عند وصول البيانات. */
export function SkeletonRows({ rows = 4, label = "جارٍ التحميل..." }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-12 text-center">
      <Inbox className="h-10 w-10 text-slate-400" aria-hidden="true" />
      <p className="font-semibold text-slate-700">{title}</p>
      {description && <p className="max-w-sm px-4 text-sm text-slate-600">{description}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-10 text-center">
      <AlertTriangle className="h-9 w-9 text-red-500" aria-hidden="true" />
      <p className="font-semibold text-red-800">حدث خطأ</p>
      <p className="max-w-sm text-sm text-red-700">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-outline mt-2">
          <RefreshCw className="h-4 w-4" /> إعادة المحاولة
        </button>
      )}
    </div>
  );
}
