import { useEffect, useState } from "react";
import { Copy, Info, MessageSquare, UserX } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { useAuth } from "../context/AuthContext";
import { buildNoShowMessage, buildSmsHref, copyText, formatDateForSms, isMobileDevice, normalizeAlgerianPhone } from "../lib/noShowSms";

export interface NoShowTarget {
  id: string;
  patientName: string;
  /** الرقم الخام كما وصل من الخادم (patient.user.phone أو guestPhone). */
  phone?: string | null;
  date?: string | null;
  startTime?: string | null;
  /** الموعد مسجَّل مسبقًا كـ NO_SHOW: نفتح الرسالة فقط دون أي تحديث جديد للحالة. */
  alreadyNoShow: boolean;
}

interface Props {
  target: NoShowTarget | null;
  /** يُحدّث حالة الموعد إلى NO_SHOW في الخادم؛ يرمي استثناءً عند الفشل. */
  onConfirm: (id: string) => Promise<unknown>;
  onClose: () => void;
}

export function NoShowSmsDialog({ target, onConfirm, onClose }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // من سُجّل غيابه مسبقًا يبدأ من خطوة الرسالة مباشرة (منع التكرار).
  useEffect(() => {
    setSent(Boolean(target?.alreadyNoShow));
    setBusy(false);
  }, [target?.id, target?.alreadyNoShow]);

  if (!target) return null;

  const doctorName = [user?.doctor?.firstName, user?.doctor?.lastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const phone = normalizeAlgerianPhone(target.phone);
  const message = buildNoShowMessage({
    doctorName,
    patientName: target.patientName,
    date: target.date,
    time: target.startTime,
  });
  const smsHref = phone ? buildSmsHref(phone, message) : null;
  const mobile = isMobileDevice();

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(target!.id);
      setSent(true);
      // فتح تطبيق الرسائل فورًا؛ إن حجبه المتصفح يبقى الزر الظاهر بديلاً.
      if (smsHref && mobile) window.location.href = smsHref;
    } catch {
      // رسالة الخطأ تُعرض من الصفحة المستدعية
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    const ok = await copyText(value);
    showToast(ok ? `تم نسخ ${label}.` : `تعذّر النسخ — انسخه يدويًا.`, ok ? "success" : "error");
  }

  const dateLabel = formatDateForSms(target.date);

  return (
    <Modal
      open
      onClose={onClose}
      title={sent ? "إشعار المريض برسالة SMS" : "تسجيل عدم حضور المريض"}
      footer={
        sent ? (
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              إلغاء
            </Button>
            <Button variant="danger" loading={busy} onClick={confirm}>
              <UserX className="ml-1.5 h-4 w-4" /> تسجيل «لم يحضر»
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="font-bold text-slate-800">{target.patientName}</p>
          <p className="text-slate-500">
            {dateLabel || "بلا تاريخ"}
            {target.startTime ? ` — ${target.startTime}` : ""}
          </p>
          <p className="text-slate-500">{phone ?? "لا يوجد رقم هاتف صالح"}</p>
        </div>

        {sent ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-emerald-50 p-3 text-emerald-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            {target.alreadyNoShow
              ? "هذا المريض مسجَّل مسبقًا كـ «لم يحضر». يمكنك إعادة فتح الرسالة دون تسجيل غياب جديد."
              : "تم تسجيل المريض كـ «لم يحضر». سيتم فتح تطبيق الرسائل لإرسال إشعار للمريض."}
          </p>
        ) : (
          <p className="text-slate-500">
            سنسجّل الغياب ثم نفتح تطبيق الرسائل في هاتفك برسالة جاهزة تُرسل من شريحتك.
          </p>
        )}

        {sent && (
          <>
            {!phone ? (
              <p className="rounded-xl bg-amber-50 p-3 text-amber-800">
                لا يوجد رقم هاتف صالح لهذا المريض — لا يمكن إرسال SMS. يمكنك نسخ نص الرسالة واستعماله يدويًا.
              </p>
            ) : mobile ? (
              <a href={smsHref!} className="btn-primary w-full justify-center">
                <MessageSquare className="ml-1.5 h-4 w-4" /> فتح تطبيق الرسائل
              </a>
            ) : (
              <p className="rounded-xl bg-slate-100 p-3 text-slate-600">
                أنت على حاسوب — لا يمكن إرسال SMS من هنا. انسخ الرقم والرسالة وأرسلهما من هاتفك.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={!phone} onClick={() => copy(phone ?? "", "رقم الهاتف")}>
                <Copy className="ml-1.5 h-4 w-4" /> نسخ رقم الهاتف
              </Button>
              <Button variant="outline" onClick={() => copy(message, "الرسالة")}>
                <Copy className="ml-1.5 h-4 w-4" /> نسخ الرسالة
              </Button>
            </div>
          </>
        )}

        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-xs leading-6 text-slate-700">
          {message}
        </pre>
      </div>
    </Modal>
  );
}
