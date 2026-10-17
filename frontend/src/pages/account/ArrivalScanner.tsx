import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { IScannerControls } from "@zxing/browser";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";

type Choice = { id: string; startTime: string; familyMemberId: string | null; familyMember: { firstName: string; lastName: string } | null; doctor: { firstName: string; lastName: string } };
export default function ArrivalScanner() {
  const { user, loading } = useAuth();
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls>();
  const pending = useRef(false);
  const cameraGeneration = useRef(0);
  const mounted = useRef(true);
  const [code, setCode] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cameraGeneration.current++; controls.current?.stop(); }; }, []);
  async function submit(value: string, appointmentId?: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const result = (await api.post('/appointments/scan-arrival', { code: value, ...(appointmentId ? { appointmentId } : {}) })).data.data;
      if (!mounted.current) return;
      if (result.choices) { setCode(value); setChoices(result.choices); setMessage('اختر صاحب الموعد الذي حضر'); }
      else { setChoices([]); setMessage(result.alreadyArrived ? 'حضورك مسجل بالفعل. يرجى انتظار دورك.' : 'تم تسجيل وصولك بنجاح. يرجى انتظار دورك.'); }
    } catch (err) { if (mounted.current) setMessage(apiErrorMessage(err, 'تعذر تسجيل الحضور. أعد المسح أو راجع الاستقبال.')); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function start() {
    const generation = ++cameraGeneration.current;
    setMessage(''); setChoices([]); setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (!mounted.current || generation !== cameraGeneration.current) return;
      const reader = new BrowserQRCodeReader();
      const session = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video.current!, (result, _err, session) => {
        if (!mounted.current || generation !== cameraGeneration.current) { session.stop(); return; }
        if (!result || pending.current) return;
        const value = result.getText();
        session.stop(); setScanning(false);
        if (!/^medbook-arrival:v1:(clinic|doctor):[0-9a-f-]{36}$/i.test(value)) { setMessage('هذا ليس كود حضور مادبوك الخاص بالعيادة.'); return; }
        void submit(value);
      });
      if (!mounted.current || generation !== cameraGeneration.current) session.stop(); else controls.current = session;
    } catch { if (mounted.current) { setScanning(false); setMessage('تعذر فتح الكاميرا. اسمح بالوصول إليها أو اطلب من المساعد تسجيل حضورك.'); } }
  }
  if (loading) return <p>جارٍ تحميل الحساب…</p>;
  if (!user) return <Navigate to="/account/login" replace />;
  return <section dir="rtl" className="mx-auto max-w-lg space-y-4 p-4">
    <h1 className="text-xl font-bold">تسجيل الوصول إلى العيادة</h1>
    <p>افتح الكاميرا ووجّهها نحو QR المطبوع في العيادة. يُسجل حضورك تلقائيًا عند قراءته.</p>
    <video ref={video} muted playsInline className={scanning ? 'w-full rounded-xl' : 'hidden'} />
    <p role="status" aria-live="polite">{message}</p>
    {choices.map(a => <button key={a.id} disabled={busy} onClick={() => void submit(code, a.id)} className="block w-full rounded-xl border p-3 text-right disabled:opacity-50">
      {a.familyMember ? a.familyMember.firstName + ' ' + a.familyMember.lastName : 'موعدي أنا'} — {a.startTime} — د. {a.doctor.firstName} {a.doctor.lastName}
    </button>)}
    {!scanning && !choices.length && <button disabled={busy} onClick={() => void start()} className="rounded-xl bg-teal-700 px-4 py-3 text-white disabled:opacity-50">📷 فتح كاميرا المسح</button>}
    {scanning && <button onClick={() => { cameraGeneration.current++; controls.current?.stop(); setScanning(false); }}>إغلاق الكاميرا</button>}
    <Link to="/account" className="block">العودة إلى حسابي</Link>
  </section>;
}
