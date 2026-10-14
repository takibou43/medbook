import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { observeKeyboardFocus } from '../lib/keyboardDiagnostics';

export default function KeyboardCheck() {
  const [text, setText] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => observeKeyboardFocus(window, document, line => setLines(old => [...old.slice(-119), line])), []);
  const report = ['MedBook keyboard-check v1', navigator.userAgent, `standalone=${window.matchMedia('(display-mode: standalone)').matches}`, ...lines].join('\n');
  return <section className="card space-y-4 p-4" dir="rtl">
    <h1 className="text-xl font-bold">فحص لوحة المفاتيح</h1>
    <p>اضغط في خانة التجربة، ثم اضغط مطولًا على المسافة وغيّر لغة لوحة المفاتيح. بعد حدوث المشكلة اضغط «نسخ التقرير» وأرسله في المحادثة.</p>
    <p className="text-sm text-slate-600">استعمل نصًا تجريبيًا. التقرير يسجل التركيز وحجم الشاشة فقط؛ لا يسجل ما تكتبه ولا يُرسل شيئًا تلقائيًا.</p>
    <label className="block">خانة بسيطة<input className="input mt-1" dir="auto" autoComplete="off" /></label>
    <Input label="خانة التطبيق" value={text} onChange={event => setText(event.target.value)} dir="auto" autoComplete="off" />
    <button type="button" className="btn-outline" onClick={() => setOpen(true)}>تجربة داخل نافذة</button>
    <Modal open={open} onClose={() => setOpen(false)} title="تجربة لوحة المفاتيح"><Input label="خانة النافذة" value={text} onChange={event => setText(event.target.value)} dir="auto" autoComplete="off" /></Modal>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-primary" onClick={async () => { try { await navigator.clipboard.writeText(report); setCopied(true); } catch { setCopied(false); } }}>نسخ التقرير</button>
      <button type="button" className="btn-outline" onClick={() => { setLines([]); setCopied(false); }}>مسح التقرير</button>
      <Link to="/settings" className="btn-outline">رجوع للإعدادات</Link>
    </div>
    {copied && <p role="status">تم نسخ التقرير. الصقه في المحادثة.</p>}
    <details open><summary>التقرير — يمكنك تصويره أيضًا</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs" dir="ltr">{report}</pre></details>
  </section>;
}
