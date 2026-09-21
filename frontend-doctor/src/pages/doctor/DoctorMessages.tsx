import { ChatPane } from "../../components/messages/ChatPane";

export default function DoctorMessages() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-slate-900">الرسائل</h1>
      <div className="card flex h-[70vh] min-h-[420px] flex-col overflow-hidden p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="font-bold text-slate-800">الإدارة</p>
          <p className="text-xs text-slate-500">محادثة خاصة بينك وبين إدارة مادبوك</p>
        </div>
        <div className="min-h-0 flex-1">
          <ChatPane scope={{ kind: "doctor" }} me="DOCTOR" peerLabel="الإدارة" />
        </div>
      </div>
    </div>
  );
}
