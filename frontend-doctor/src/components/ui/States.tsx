import { Loader2, Inbox, AlertTriangle } from "lucide-react";

export function Spinner({ label = "جارٍ التحميل..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
      <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-16 text-center">
      <Inbox className="h-10 w-10 text-slate-300" />
      <p className="font-semibold text-slate-700">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 py-16 text-center">
      <AlertTriangle className="h-10 w-10 text-red-400" />
      <p className="font-semibold text-red-700">حدث خطأ</p>
      <p className="max-w-sm text-sm text-red-600">{message}</p>
    </div>
  );
}
