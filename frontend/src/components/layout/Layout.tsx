import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale";

export function PublicLayout() {
  useLanguage();
  return (
    <div className="patient-bg flex min-h-[100dvh] flex-col">
      <a href="#main-content" className="skip-link">{t("الانتقال إلى المحتوى")}</a>
      <Header />
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
