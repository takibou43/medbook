import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale";
import { arrivalCodeFromQr } from "../../lib/arrivalQr";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { cameraErrorMessage } from "../../lib/arrivalCamera";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type { IScannerControls } from "@zxing/browser";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";

type Choice = { id: string; startTime: string; familyMemberId: string | null; familyMember: { firstName: string; lastName: string } | null; doctor: { firstName: string; lastName: string } };
export default function ArrivalScanner() {
  useLanguage();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const suppliedCode = params.get("code");
  const redirect = "/account/arrival" + (suppliedCode ? "?code=" + encodeURIComponent(suppliedCode) : "");
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls>();
  const pending = useRef(false);
  const autoStarted = useRef<string | null>(null);
  const cameraGeneration = useRef(0);
  const mounted = useRef(true);
  const [code, setCode] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<'info' | 'success' | 'error'>('info');
  const [scanning, setScanning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const track = () => (video.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
  function stopCamera() { cameraGeneration.current++; controls.current?.stop(); track()?.stop(); setScanning(false); setTorchOn(false); setTorchSupported(false); }
  async function toggleTorch() {
    const current = track(); if (!current || torchBusy) return;
    setTorchBusy(true);
    try { await current.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] }); if (mounted.current) setTorchOn(!torchOn); }
    catch { if (mounted.current) { setFeedback('error'); setMessage('تعذّر تشغيل الفلاش. حسّن الإضاءة أو حاول مجددًا.'); } }
    finally { if (mounted.current) setTorchBusy(false); }
  }
  const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cameraGeneration.current++; controls.current?.stop(); track()?.stop(); }; }, []);
  async function submit(value: string, appointmentId?: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFeedback('info'); setMessage('جارٍ تسجيل وصولك لدى العيادة…');
    try {
      const result = (await api.post('/appointments/scan-arrival', { code: value, ...(appointmentId ? { appointmentId } : {}) })).data.data;
      if (!mounted.current) return;
      if (result.bookingRequired && typeof result.bookingPath === 'string' && result.bookingPath.startsWith('/') && !result.bookingPath.startsWith('//')) { setMessage('لا يوجد موعد اليوم. جارٍ فتح الحجز…'); navigate(result.bookingPath); return; }
      if (result.choices) { setCode(value); setChoices(result.choices); setMessage('اختر الموعد وصاحبه الذي حضر'); }
      else if (typeof result.appointmentId === 'string' && (result.alreadyArrived || result.arrivedAt)) { setArrivedId(result.appointmentId); setChoices([]); setFeedback('success'); setMessage(result.alreadyArrived ? 'حضورك مسجل بالفعل. يرجى انتظار دورك.' : 'تم تسجيل وصولك بنجاح. يرجى انتظار دورك.'); }
      else { setFeedback('error'); setMessage('لم يؤكد الخادم تسجيل وصولك. أعد المحاولة أو راجع الاستقبال.'); }
    } catch (err) { if (mounted.current) { setFeedback('error'); setMessage(apiErrorMessage(err, 'تعذر تسجيل الحضور. أعد المسح أو راجع الاستقبال.')); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function start() {
    stopCamera(); setArrivedId(null);
    const generation = ++cameraGeneration.current;
    setFeedback('info'); setMessage('وجّه الكاميرا نحو كود الحضور الجديد المطبوع داخل العيادة.'); setChoices([]); setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (!mounted.current || generation !== cameraGeneration.current) return;
      const reader = new BrowserQRCodeReader();
      const session = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video.current!, (result, _err, session) => {
        if (!mounted.current || generation !== cameraGeneration.current) { session.stop(); return; }
        if (!result || pending.current) return;
        const value = arrivalCodeFromQr(result.getText(), window.location.origin);
        session.stop(); stopCamera();
        if (!value) { setFeedback('error'); setMessage('لم يُسجَّل الحضور: هذا الكود غير صالح. امسح كود الحضور الجديد من العيادة؛ كود الحجز لا يسجّل الحضور.'); return; }
        void submit(value);
      });
      if (!mounted.current || generation !== cameraGeneration.current) session.stop(); else { controls.current = session; const capabilities = track()?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined; setTorchSupported(capabilities?.torch === true); }
    } catch (error) { if (mounted.current && generation === cameraGeneration.current) { stopCamera(); setFeedback('error'); setMessage(cameraErrorMessage(error)); } }
  }
  useEffect(() => {
    const key = suppliedCode ?? 'camera';
    if (!user || loading || autoStarted.current === key) return;
    autoStarted.current = key;
    if (suppliedCode) {
      const value = arrivalCodeFromQr(suppliedCode, window.location.origin);
      if (value) void submit(value);
      else { setFeedback('error'); setMessage('رابط الحضور غير صالح. امسح كود العيادة مرة أخرى.'); }
    } else void start();
  }, [user?.id, loading, suppliedCode]);
  if (loading) return <p>{t("جارٍ تحميل الحساب…")}</p>;
  if (!user) return <Navigate to={"/account/login?mode=register&redirect=" + encodeURIComponent(redirect)} replace />;
  return <section className="mx-auto max-w-lg space-y-4 p-4">
    <h1 className="text-xl font-bold">{t("مسح QR لتسجيل الوصول")}</h1>
    <p className="text-sm text-slate-600">{t("وجّه الكاميرا نحو رمز الحضور داخل العيادة")}</p>
    <div className={scanning ? "relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900" : "hidden"}>
      <video ref={video} muted playsInline className="h-full w-full object-cover" />
      <span className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/80" aria-hidden="true" />
    </div>
    {scanning && <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-outline min-h-[44px]" onClick={() => void start()} disabled={busy}>{t("إعادة تشغيل الكاميرا")}</button>
      <button type="button" className="btn-outline min-h-[44px]" onClick={stopCamera}>{t("إغلاق الكاميرا")}</button>
      {torchSupported && <button type="button" className="btn-outline min-h-[44px]" aria-pressed={torchOn} disabled={torchBusy} onClick={() => void toggleTorch()}>{t(torchOn ? "إيقاف الفلاش" : "تشغيل الفلاش")}</button>}
    </div>}
    <div role="status" aria-live={feedback === 'error' ? 'assertive' : 'polite'} aria-busy={busy} className={"flex items-start gap-3 rounded-xl border p-4 text-base font-semibold " + (feedback === 'success' ? 'border-green-300 bg-green-50 text-green-900' : feedback === 'error' ? 'border-red-300 bg-red-50 text-red-900' : 'border-blue-200 bg-blue-50 text-blue-900')}>
      {busy ? <Loader2 className="h-6 w-6 shrink-0 animate-spin" aria-hidden="true" /> : feedback === 'success' ? <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" /> : feedback === 'error' ? <AlertCircle className="h-6 w-6 shrink-0" aria-hidden="true" /> : null}
      <p>{t(message)}</p>
    </div>
    {choices.map(a => <button key={a.id} disabled={busy} onClick={() => void submit(code, a.id)} className="block w-full rounded-xl border p-3 text-start disabled:opacity-50">
      {a.familyMember ? a.familyMember.firstName + ' ' + a.familyMember.lastName : t("موعدي أنا")} — {a.startTime} — {t("د. ")}{a.doctor.firstName} {a.doctor.lastName}
    </button>)}
    {!scanning && !choices.length && <button disabled={busy} onClick={() => void start()} className="rounded-xl bg-teal-700 px-4 py-3 text-white disabled:opacity-50">{t("فتح كاميرا المسح")}</button>}
    {arrivedId && <Link className="btn-primary min-h-[44px]" to={`/status/${encodeURIComponent(arrivedId)}`}>{t("تتبّع دوري")}</Link>}
    <Link to="/account" className="block">{t("العودة إلى حسابي")}</Link>
  </section>;
}
