import { t } from "../i18n/locale.ts";
import { Component, type ReactNode } from "react";
import { Button } from "./ui/Button";

type Props = { children: ReactNode; resetKey?: string };

/**
 * انقطاع الاتصال أثناء تحميل صفحة يترك زر إعادة تحميل بدل شاشة فارغة.
 * resetKey (المسار): يُلغى الخطأ عند الانتقال إلى صفحة أخرى دون إعادة تركيب الصفحات السليمة،
 * فتبقى حالتها (البحث، رقم الصفحة) كما هي عند التنقل بين /clinics و/clinics/:id.
 */
export class PageLoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container-app py-10 text-center" role="alert">
        <p className="mb-4">{t("تعذّر فتح الصفحة. تحقق من اتصال الإنترنت ثم أعد المحاولة.")}</p>
        <Button onClick={() => window.location.reload()}>{t("إعادة تحميل الصفحة")}</Button>
      </div>
    );
  }
}
