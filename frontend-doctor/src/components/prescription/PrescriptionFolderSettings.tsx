import { useState } from "react";
import { usePrescriptionFolder } from "../../hooks/usePrescriptionFolder";
import { choosePrescriptionFolder, folderSupported, removePrescriptionFolder } from "../../lib/prescriptionFolder";
import { Button } from "../ui/Button";
import { t } from "../../i18n/locale.ts";

export function PrescriptionFolderSettings({ uid }: { uid: string }) {
  const { folder, loading, error } = usePrescriptionFolder(uid);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function choose() {
    setBusy(true); setMessage("");
    try { await choosePrescriptionFolder(uid); }
    catch (err) { if (!(err instanceof DOMException && err.name === "AbortError")) setMessage(t("تعذّر اختيار المجلد أو حفظ الإذن. حاول مجددًا.")); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMessage("");
    try { await removePrescriptionFolder(uid); }
    catch { setMessage(t("تعذّر تغيير إعداد الحفظ.")); }
    finally { setBusy(false); }
  }
  return <fieldset className="space-y-2 rounded-xl border border-slate-200 p-3">
    <legend className="px-1 text-sm font-semibold">{t("حفظ نسخة PDF عند الطباعة")}</legend>
    <p className="text-sm text-slate-600">{t("اختر مجلدًا مرة واحدة على هذا الجهاز. عند الضغط على طباعة تُحفظ نسخة PDF كاملة ثم تُفتح نافذة الطباعة، حتى إذا ألغيت الطباعة الورقية.")}</p>
    <p className="text-xs text-slate-500">{t("الإعداد خاص بحسابك وهذا المتصفح، وقد يطلب المتصفح تجديد إذن الكتابة. يمكن تغيير المجلد أو إيقاف الحفظ هنا.")}</p>
    {folder && <p role="status" className="text-sm">{t("المجلد المختار:")} <bdi>{folder.directory.name}</bdi></p>}
    {!folderSupported() ? <p className="text-sm text-amber-800">{t("هذا المتصفح لا يدعم اختيار مجلد للحفظ التلقائي. يمكن حفظ PDF يدويًا من نافذة الطباعة.")}</p> :
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={loading || busy} onClick={choose}>{folder ? t("تغيير المجلد") : t("اختيار مجلد وتفعيل الحفظ")}</Button>
        {folder && <Button type="button" variant="ghost" disabled={busy} onClick={remove}>{t("إيقاف الحفظ التلقائي")}</Button>}
      </div>}
    {(message || error) && <p role="alert" className="text-sm text-red-700">{message || t("تعذّر قراءة إعداد المجلد على هذا الجهاز.")}</p>}
  </fieldset>;
}
