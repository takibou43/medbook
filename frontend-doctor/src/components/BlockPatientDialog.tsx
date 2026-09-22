import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api, apiErrorMessage } from "../lib/api";

export interface BlockTarget {
  patientId: string;
  name: string;
  email: string;
}

/** نافذة تأكيد الحظر أو إلغاء الحظر — مشتركة بين قائمة المستخدمين وصفحة المرضى المحظورين. */
export function BlockPatientDialog({
  target,
  mode,
  onClose,
}: {
  target: BlockTarget | null;
  mode: "block" | "unblock";
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const qc = useQueryClient();

  function close() {
    setReason("");
    onClose();
  }

  async function confirm() {
    if (!target) return;
    setBusy(true);
    try {
      if (mode === "block") {
        await api.post(`/admin/patients/${target.patientId}/block`, { reason: reason.trim() || undefined });
        showToast(`تم حظر المريض ${target.name}. لن يستطيع إنشاء حجوزات جديدة.`, "success");
      } else {
        await api.post(`/admin/patients/${target.patientId}/unblock`);
        showToast(`تم إلغاء حظر المريض ${target.name}. يستطيع الحجز من جديد.`, "success");
      }
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-patient-blocks"] });
      close();
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      onClose={close}
      title={mode === "block" ? "حظر المريض" : "إلغاء حظر المريض"}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            إلغاء
          </Button>
          <Button variant={mode === "block" ? "danger" : "primary"} onClick={confirm} loading={busy}>
            {mode === "block" ? "تأكيد الحظر" : "تأكيد إلغاء الحظر"}
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-bold text-slate-900">{target.name}</p>
            <p className="text-slate-600" dir="ltr">{target.email}</p>
          </div>
          {mode === "block" ? (
            <>
              <p className="rounded-xl bg-amber-50 p-3 text-amber-800">
                الحظر سيمنع هذا المريض من إنشاء حجوزات جديدة. حجوزاته الحالية وحسابه تبقى كما هي، ويستطيع تسجيل الدخول.
              </p>
              <label className="block">
                <span className="mb-1 block font-semibold text-slate-700">سبب الحظر (اختياري — لا يظهر للمريض)</span>
                <textarea className="input min-h-[80px]" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            </>
          ) : (
            <p className="rounded-xl bg-green-50 p-3 text-green-800">سيعود المريض للوضع الطبيعي ويستطيع إنشاء حجوزات جديدة. يبقى سجل الحظر السابق محفوظًا.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
