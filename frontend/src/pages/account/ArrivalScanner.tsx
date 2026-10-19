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
  const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cameraGeneration.current++; controls.current?.stop(); }; }, []);
  async function submit(value: string, appointmentId?: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFeedback('info'); setMessage('جارٍ تسجيل وصولك لدى العيادة…');
    try {
      const result = (await api.post('/appointments/scan-arrival', { code: value, ...(appointmentId ? { appointmentId } : {}) })).data.data;
      if (!mounted.current) return;
      if (result.bookingRequired && typeof result.bookingPath === 'string' && result.bookingPath.startsWith('/') && !result.bookingPath.startsWith('//')) { setMessage('لا يوجد موعد اليوم. جارٍ فتح الحجز…'); navigate(result.bookingPath); return; }
      if (result.choices) { setCode(value); setChoices(result.choices); setMessage('اختر الموعد وصاحبه الذي حضر'); }
      else if (typeof result.appointmentId === 'string' && (result.alreadyArrived || result.arrivedAt)) { setChoices([]); setFeedback('success'); setMessage(result.alreadyArrived ? 'حضورك مسجل بالفعل. يرجى انتظار دورك.' : 'تم تسجيل وصولك بنجاح. يرجى انتظار دورك.'); }
      else { setFeedback('error'); setMessage('لم يؤكد الخادم تسجيل وصولك. أعد المحاولة أو راجع الاستقبال.'); }
    } catch (err) { if (mounted.current) { setFeedback('error'); setMessage(apiErrorMessage(err, 'تعذر تسجيل الحضور. أعد المسح أو راجع الاستقبال.')); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function start() {
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
        session.stop(); setScanning(false);
        if (!value) { setFeedback('error'); setMessage('لم يُسجَّل الحضور: هذا الكود غير صالح. امسح كود الحضور الجديد من العيادة؛ كود الحجز لا يسجّل الحضور.'); return; }
        void submit(value);
      });
      if (!mounted.current || generation !== cameraGeneration.current) session.stop(); else controls.current = session;
    } catch (error) { if (mounted.current && generation === cameraGeneration.current) { setScanning(false); setFeedback('error'); setMessage(cameraErrorMessage(error)); } }
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
  if (loading) return <p>جارٍ تحميل الحساب…</p>;
  if (!user) return <Navigate to={"/account/login?mode=register&redirect=" + encodeURIComponent(redirect)} replace />;
  return <section dir="rtl" className="mx-auto max-w-lg space-y-4 p-4">
    <h1 className="text-xl font-bold">تسجيل الوصول إلى العيادة</h1>
    <p>افتح الكاميرا ووجّهها نحو QR المطبوع في العيادة. إذا كان لديك موعد اليوم يُسجل وصولك، وإلا تفتح خيارات الحجز في العيادة.</p>
    <video ref={video} muted playsInline className={scanning ? 'w-full rounded-xl' : 'hidden'} />
    <div role="status" aria-live={feedback === 'error' ? 'assertive' : 'polite'} aria-busy={busy} className={"flex items-start gap-3 rounded-xl border p-4 text-base font-semibold " + (feedback === 'success' ? 'border-green-300 bg-green-50 text-green-900' : feedback === 'error' ? 'border-red-300 bg-red-50 text-red-900' : 'border-blue-200 bg-blue-50 text-blue-900')}>
      {busy ? <Loader2 className="h-6 w-6 shrink-0 animate-spin" aria-hidden="true" /> : feedback === 'success' ? <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" /> : feedback === 'error' ? <AlertCircle className="h-6 w-6 shrink-0" aria-hidden="true" /> : null}
      <p>{message}</p>
    </div>
    {choices.map(a => <button key={a.id} disabled={busy} onClick={() => void submit(code, a.id)} className="block w-full rounded-xl border p-3 text-right disabled:opacity-50">
      {a.familyMember ? a.familyMember.firstName + ' ' + a.familyMember.lastName : 'موعدي أنا'} — {a.startTime} — د. {a.doctor.firstName} {a.doctor.lastName}
    </button>)}
    {!scanning && !choices.length && <button disabled={busy} onClick={() => void start()} className="rounded-xl bg-teal-700 px-4 py-3 text-white disabled:opacity-50">📷 فتح كاميرا المسح</button>}
    {scanning && <button onClick={() => { cameraGeneration.current++; controls.current?.stop(); setScanning(false); }}>إغلاق الكاميرا</button>}
    <Link to="/account" className="block">العودة إلى حسابي</Link>
  </section>;
}
