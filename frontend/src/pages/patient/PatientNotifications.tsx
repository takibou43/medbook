import { Bell, BellRing } from "lucide-react";
import { useNotifications, useMarkAllNotificationsRead } from "../../hooks/useNotifications";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import clsx from "clsx";

export default function PatientNotifications() {
  const { data: notifications, isLoading } = useNotifications();
  const markAllRead = useMarkAllNotificationsRead();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-900">الإشعارات</h1>
        <Button variant="outline" onClick={() => markAllRead.mutate()}>
          تعليم الكل كمقروء
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : notifications && notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className={clsx("card flex items-start gap-3 p-4", !n.isRead && "border-primary-200 bg-primary-50/40")}>
              {n.isRead ? <Bell className="mt-0.5 h-5 w-5 text-slate-400" /> : <BellRing className="mt-0.5 h-5 w-5 text-primary-600" />}
              <div>
                <p className="font-semibold text-slate-800">{n.title}</p>
                <p className="text-sm text-slate-600">{n.message}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString("ar-DZ")}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="لا توجد إشعارات" />
      )}
    </div>
  );
}
