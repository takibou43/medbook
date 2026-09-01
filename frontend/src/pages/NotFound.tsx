import { Link } from "react-router-dom";
import { Stethoscope } from "lucide-react";

export default function NotFound() {
  return (
    <div className="container-app flex min-h-[70vh] flex-col items-center justify-center text-center">
      <Stethoscope className="mb-4 h-12 w-12 text-primary-300" />
      <h1 className="text-3xl font-extrabold text-slate-900">404</h1>
      <p className="mt-2 text-slate-500">الصفحة التي تبحث عنها غير موجودة.</p>
      <Link to="/" className="btn-primary mt-6">
        العودة إلى الرئيسية
      </Link>
    </div>
  );
}
