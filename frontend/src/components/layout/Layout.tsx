import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Spinner } from "../ui/States";
import { PageLoadBoundary } from "../PageLoadBoundary";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale";

export function PublicLayout() {
  useLanguage();
  const { pathname } = useLocation();
  return (
    <div className="patient-bg flex min-h-[100dvh] flex-col">
      <a href="#main-content" className="skip-link">{t("الانتقال إلى المحتوى")}</a>
      <Header />
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        {/* resetKey: خطأ تحميل صفحة لا يبقى عالقًا بعد الانتقال، دون إعادة تركيب الصفحات السليمة */}
        <PageLoadBoundary resetKey={pathname}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </PageLoadBoundary>
      </main>
      <Footer />
    </div>
  );
}
