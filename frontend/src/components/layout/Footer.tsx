import { Stethoscope } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="container-app grid gap-8 py-10 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary-700">
            <Stethoscope className="h-5 w-5" />
            <span className="text-lg font-extrabold">MedBook</span>
          </div>
          <p className="text-sm text-slate-500">منصة رقمية جزائرية لحجز المواعيد الطبية بسهولة وأمان.</p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold text-slate-800">تواصل معنا</h4>
          <p className="text-sm text-slate-500">support@medbook.dz</p>
        </div>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} MedBook — جميع الحقوق محفوظة
      </div>
    </footer>
  );
}
