import { useNavigate } from "react-router-dom";
import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** إن وُجد يصبح الإشعار كله قابلًا للنقر وينقل إلى هذا المسار. */
  href?: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind, href?: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-green-600" />,
  error: <XCircle className="h-5 w-5 text-red-600" />,
  info: <Info className="h-5 w-5 text-blue-600" />,
};

const STYLES: Record<ToastKind, string> = {
  success: "border-green-200 bg-green-50",
  error: "border-red-200 bg-red-50",
  info: "border-blue-200 bg-blue-50",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const navigate = useNavigate();

  const showToast = useCallback((message: string, kind: ToastKind = "info", href?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message, href }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 left-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-xl border p-3 shadow-card ${STYLES[t.kind]}`}>
            {ICONS[t.kind]}
            {t.href ? (
              <button
                type="button"
                onClick={() => {
                  dismiss(t.id);
                  navigate(t.href!);
                }}
                className="flex-1 cursor-pointer text-start text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
              >
                {t.message}
              </button>
            ) : (
              <p className="flex-1 text-sm text-slate-700">{t.message}</p>
            )}
            <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast يجب أن يُستخدم داخل ToastProvider");
  return ctx;
}
