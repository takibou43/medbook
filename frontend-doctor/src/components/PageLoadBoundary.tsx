import { Component, type ReactNode } from "react";
import { Button } from "./ui/Button";

/** A lost connection while loading a page must leave a usable recovery action. */
export class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container-app py-10 text-center" role="alert" dir="rtl">
        <p className="mb-4">تعذّر فتح الصفحة. تحقق من اتصال الإنترنت ثم أعد المحاولة.</p>
        <Button onClick={() => window.location.reload()}>إعادة تحميل الصفحة</Button>
      </div>
    );
  }
}
