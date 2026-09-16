import { useEffect, useState } from "react";
import { Copy, Info, MessageSquare, UserX } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { useAuth } from "../context/AuthContext";
import {
  buildNoShowMessage,
  buildQueueCallMessage,
  buildSmsHref,
  copyText,
  formatDateForSms,
  isMobileDevice,
  normalizeAlgerianPhone,
} from "../lib/noShowSms";

/**
 * وضعان لهذه النافذة:
 * - "call": نودي على المريض فلم يستجب. نفتح رسالة «دورك قد حان» فقط، ويبقى الموعد
 *   قابلًا للمتابعة (ينتقل إلى قائمة المتأخرين) — بلا أي غياب نهائي. الغياب النهائي
 *   يُعتمد وحده عند انتهاء دوام الطبيب (autoExpireStaleAppointments في الخادم).
 * - "final": صفحة المواعيد — تسجيل «لم يحضر» يدويًا كما كان تمامًا، بلا تغيير.
 */
export type NoShowDialogMode = "call" | "final";

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
  /** الافتراضي "final" حتى تبقى صفحة المواعيد على سلوكها السابق حرفيًا. */
  mode?: NoShowDialogMode;
  /** "final": يُحدّث الحالة إلى NO_SHOW. "call": ينقل الموعد إلى المتأخرين. يرمي استثناءً عند الفشل. */
  onConfirm: (id: string) => Promise<unknown>;
  onClose: () => void;
}

const NO_PHONE_MESSAGE = "لا يوجد رقم هاتف صالح لهذا المريض.";

export function NoShowSmsDialog({ target, mode = "final", onConfirm, onClose }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  // نص الرسالة قابل للتعديل قبل فتح تطبيق الرسائل.
  const [message, setMessage] = useState("");

  const doctorName = [user?.doctor?.firstName, user?.doctor?.lastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const callMode = mode === "call";

  // نص افتراضي جديد مع كل موعد. في وضع النداء نبدأ دائمًا من الخطوة الأولى، وفي الوضع
  // النهائي من سُجّل غيابه مسبقًا يبدأ من خطوة الرسالة مباشرة (منع التكرار).
  useEffect(() => {
    if (!target) return;
    setSent(callMode ? false : Boolean(target.alreadyNoShow));
    setBusy(false);
    setMessage(
      callMode
        ? buildQueueCallMessage({ doctorName, patientName: target.patientName })
        : buildNoShowMessage({
            doctorName,
            patientName: target.patientName,
            date: target.date,
            time: target.startTime,
          })
    );
  }, [target?.id, target?.alreadyNoShow, callMode, doctorName]);

  if (!target) return null;

  const phone = normalizeAlgerianPhone(target.phone);
  const mobile = isMobileDevice();
  // يُبنى من النص الحالي، فأي تعديل يكتبه المساعد يصل إلى تطبيق الرسائل مُرمَّزًا.
  const smsHref = phone ? buildSmsHref(phone, message) : null;
  const dateLabel = formatDateForSms(target.date);

  async function copy(value: string, label: string) {
    const ok = await copyText(value);
    showToast(ok ? `تم نسخ ${label}.` : `تعذّر النسخ — انسخه يدويًا.`, ok ? "success" : "error");
  }

  async function confirm() {
    if (busy || !target) return;
    // وضع النداء بلا رقم صالح: لا نفتح الرسائل ولا نغيّر حالة الموعد إطلاقًا.
    if (callMode && !phone) {
      showToast(NO_PHONE_MESSAGE, "error");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(target.id);
      setSent(true);
      if (smsHref && mobile) {
        // فتح تطبيق الرسائل فورًا؛ إن حجبه المتصفح يبقى الزر الظاهر بديلاً.
        window.location.href = smsHref;
      } else if (callMode) {
        // حاسوب: لا تطبيق رسائل هنا — ننسخ النص ولا ندّعي أن الرسالة أُرسلت.
        const ok = await copyText(message);
        showToast(
          ok ? "تم نسخ الرسالة — أرسلها من هاتفك (لم تُرسل بعد)." : "انسخ الرقم والرسالة وأرسلهما من هاتفك.",
          ok ? "success" : "error"
        );
      }
    } catch {
      // رسالة الخطأ تُعرض من الصفحة المستدعية
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={callMode ? "المريض لم يحضر — إشعاره برسالة" : sent ? "إشعار المريض برسالة SMS" : "تسجيل عدم حضور المريض"}
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
            {callMode ? (
              <Button loading={busy} onClick={confirm}>
                <MessageSquare className="ml-1.5 h-4 w-4" /> فتح الرسائل
              </Button>
            ) : (
              <Button variant="danger" loading={busy} onClick={confirm}>
                <UserX className="ml-1.5 h-4 w-4" /> تسجيل «لم يحضر»
              </Button>
            )}
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
          {phone ? (
            <p className="text-slate-500" dir="ltr">
              {phone}
            </p>
          ) : (
            <p className="font-semibold text-amber-700">{NO_PHONE_MESSAGE}</p>
          )}
        </div>

        {sent ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-emerald-50 p-3 text-emerald-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            {callMode
              ? "لم يُسجَّل غياب نهائي: بقي الموعد في المتابعة ويعود دوره بعد مريضين، ويُعتمد الغياب تلقائيًا عند انتهاء دوام الطبيب فقط."
              : target.alreadyNoShow
              ? "هذا المريض مسجَّل مسبقًا كـ «لم يحضر». يمكنك إعادة فتح الرسالة دون تسجيل غياب جديد."
              : "تم تسجيل المريض كـ «لم يحضر». سيتم فتح تطبيق الرسائل لإرسال إشعار للمريض."}
          </p>
        ) : (
          <p className="text-slate-500">
            {callMode
              ? "سيتم فتح تطبيق الرسائل في هاتفك، ويمكنك تعديل الرسالة قبل إرسالها. لن يُسجَّل الموعد كغياب نهائي."
              : "سنسجّل الغياب ثم نفتح تطبيق الرسائل في هاتفك برسالة جاهزة تُرسل من شريحتك."}
          </p>
        )}

        <div>
          <label className="label" htmlFor="sms-message">
            نص الرسالة (يمكنك تعديله)
          </label>
          <textarea
            id="sms-message"
            className="input min-h-[7rem] leading-6"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        {sent && (
          <>
            {!phone ? (
              <p className="rounded-xl bg-amber-50 p-3 text-amber-800">
                {NO_PHONE_MESSAGE} يمكنك نسخ نص الرسالة واستعماله يدويًا.
              </p>
            ) : mobile ? (
              <a href={smsHref!} className="btn-primary w-full justify-center">
                <MessageSquare className="ml-1.5 h-4 w-4" /> فتح تطبيق الرسائل
              </a>
            ) : (
              <p className="rounded-xl bg-slate-100 p-3 text-slate-600">
                أنت على حاسوب — لا يمكن فتح تطبيق الرسائل من هنا ولم تُرسل أي رسالة. انسخ الرقم والرسالة وأرسلهما
                من هاتفك.
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
      </div>
    </Modal>
  );
}
