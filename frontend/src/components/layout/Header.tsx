import { Link } from "react-router-dom";
import { Logo } from "../ui/Logo";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="container-app flex h-16 items-center">
        <Link to="/" className="flex items-center gap-2 text-primary-700">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-extrabold">MedBook</span>
        </Link>
      </div>
    </header>
  );
}
