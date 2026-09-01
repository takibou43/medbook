import { Link } from "react-router-dom";
import { Stethoscope } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="container-app flex h-16 items-center">
        <Link to="/" className="flex items-center gap-2 text-primary-700">
          <div className="rounded-xl bg-primary-600 p-1.5 text-white">
            <Stethoscope className="h-5 w-5" />
          </div>
          <span className="text-lg font-extrabold">MedBook</span>
        </Link>
      </div>
    </header>
  );
}
