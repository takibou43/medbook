import { Phone } from "lucide-react";
import { Logo } from "../ui/Logo";

// رقم مادبوك الرسمي للتواصل المباشر — بصيغة جزائرية دون مسافات (tel: يتطلب ذلك).
// نفس الرقم يُعرض في الواجهة وفي رابط tel: (لا رقم مختلف بينهما).
const MEDBOOK_PHONE = "+213552530669";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="container-app grid gap-8 py-10 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary-700">
            <Logo className="h-7 w-7" />
            <span className="text-lg font-extrabold">MedBook</span>
          </div>
          <p className="text-sm text-slate-500">منصة رقمية جزائرية لحجز المواعيد الطبية بسهولة وأمان.</p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold text-slate-800">تواصل معنا</h4>
          <a
            href={`tel:${MEDBOOK_PHONE}`}
            className="btn-primary w-full sm:w-auto"
            aria-label={`اتصل بمادبوك على الرقم ${MEDBOOK_PHONE}`}
          >
            <Phone className="h-4 w-4" />
            اتصل بمادبوك
          </a>
        </div>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} MedBook — جميع الحقوق محفوظة
      </div>
    </footer>
  );
}
