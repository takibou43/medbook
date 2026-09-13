import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * شريط "تثبيت مادبوك" — غير مزعج بالقصد:
 *  - لا يظهر إطلاقًا إذا كان التطبيق مثبّتًا ويعمل في وضع standalone.
 *  - لا يظهر إذا كان المتصفح لا يدعم التثبيت (لا beforeinstallprompt ولا سفاري آيفون).
 *  - إذا أغلقه المستخدم لا يعود قبل 30 يومًا.
 *  - يتأخّر ظهوره بضع ثوانٍ حتى لا يقفز في وجه الطبيب أول ما يفتح اللوحة.
 */

/** حدث التثبيت في كروم/إيدج؛ ليس ضمن تعريفات TypeScript القياسية. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "medbook_doctor_install_dismissed_at";
const DISMISS_DAYS = 30;
const SHOW_DELAY_MS = 6000;

function isInstalled(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  // على آيفون، المتصفحات الأخرى (كروم، فايرفوكس، إيدج) لا تملك "إضافة إلى الشاشة الرئيسية".
  return !/CriOS|FxiOS|OPiOS|EdgiOS|GSA/.test(ua);
}

// لا نخزّن هنا سوى ختم زمني لإغلاق الشريط — لا بيانات مريض ولا موعد ولا أي معلومة طبية.
function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // التصفّح الخاص قد يمنع التخزين — لا يضرّ، سيظهر الشريط مرة أخرى لاحقًا فقط.
  }
}

export function InstallPrompt() {
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isInstalled() || dismissedRecently()) return;

    let timer: number | undefined;

    function onBeforeInstallPrompt(e: Event) {
      // منع شريط كروم التلقائي لنتحكّم نحن في توقيت العرض ومكانه.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      // المتصفح قد يعيد إطلاق الحدث داخل الجلسة نفسها؛ نحترم إغلاق المستخدم في كل مرة.
      if (dismissedRecently()) return;
      timer = window.setTimeout(() => setMode("prompt"), SHOW_DELAY_MS);
    }

    function onInstalled() {
      setMode("hidden");
      setDeferred(null);
      rememberDismiss();
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // آيفون لا يُطلق beforeinstallprompt إطلاقًا، فنعرض له إرشادًا نصيًا بدل الزر.
    if (isIosSafari()) {
      timer = window.setTimeout(() => setMode("ios"), SHOW_DELAY_MS);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  function close() {
    setMode("hidden");
    rememberDismiss();
  }

  async function install() {
    if (!deferred) return;
    setMode("hidden");
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    rememberDismiss();
  }

  if (mode === "hidden") return null;

  return (
    <div className="pwa-install-bar fixed inset-x-0 bottom-0 z-50 px-3">
      <div className="card mx-auto flex max-w-md items-center gap-3 p-3 shadow-lg">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0" />

        <div className="min-w-0 flex-1">
          {mode === "prompt" ? (
            <>
              <p className="text-sm font-bold text-slate-800">ثبّت لوحة مادبوك على هاتفك</p>
              <p className="text-xs text-slate-500">أيقونة على شاشتك تفتح اللوحة مباشرة بلا شريط متصفح.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-slate-800">أضِف مادبوك إلى شاشتك</p>
              <p className="text-xs leading-6 text-slate-500">
                اضغط زر المشاركة في شريط سفاري، ثم اختر «إضافة إلى الشاشة الرئيسية».
              </p>
            </>
          )}
        </div>

        {mode === "prompt" && (
          <button onClick={install} className="btn-primary shrink-0 px-3 py-2 text-xs">
            <Download className="h-4 w-4" />
            تثبيت مادبوك
          </button>
        )}

        <button onClick={close} aria-label="إغلاق" className="btn-ghost shrink-0 px-2 py-2">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
