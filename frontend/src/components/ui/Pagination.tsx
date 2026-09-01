import { ChevronRight, ChevronLeft } from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <button
        className="btn-outline !px-3"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="السابق"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="px-3 text-sm text-slate-600">
        صفحة {page} من {totalPages}
      </span>
      <button
        className="btn-outline !px-3"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="التالي"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    </div>
  );
}
