import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useSearchParams } from "react-router-dom";
import { ChatPane } from "../../components/messages/ChatPane";

export default function DoctorMessages() {
  useLanguage();
  // /messages?focus=unread يأتي من الإشعار/التوست/الشارة: نبرز رسالة الإدارة ثم ننظّف الرابط.
  const [params, setParams] = useSearchParams();
  const focusUnread = params.get("focus") === "unread";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-slate-900">{t("مراسلة الإدارة")}</h1>
      <div className="card flex h-[70vh] min-h-[420px] flex-col overflow-hidden p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="font-bold text-slate-800">{t("إدارة MedBook")}</p>
          <p className="text-xs text-slate-500">{t("محادثة رسمية خاصة بينك وبين إدارة MedBook فقط — لا يراها أي طبيب آخر")}</p>
        </div>
        <div className="min-h-0 flex-1">
          <ChatPane
            scope={{ kind: "doctor" }}
            me="DOCTOR"
            peerLabel={t("إدارة MedBook")}
            focusUnread={focusUnread}
            onFocusHandled={() => setParams({}, { replace: true })}
          />
        </div>
      </div>
    </div>
  );
}
