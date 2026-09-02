import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, CalendarDays, Clock, XCircle } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Spinner, EmptyState } from "../components/ui/States";
import { useToast } from "../components/ui/Toast";
import { Appointment } from "../types";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "بانتظار التأكيد",
  CONFIRMED: "مؤكد",
};

export default function TrackBooking() {
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [searchedPhone, setSearchedPhone] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const lookupMutation = useMutation({
    mutationFn: async (p: string) => (await api.get<{ data: Appointment[] }>("/booking/lookup", { params: { phone: p } })).data.data,
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/booking/${id}/cancel`, { phone: searchedPhone })).data.data,
  });

  function search(p: string) {
    if (!/^0[5-7][0-9]{8}$/.test(p)) {
      showToast("الرجاء إدخال رقم هاتف جزائري صالح.", "error");
      return;
    }
    setSearchedPhone(p);
    lookupMutation.mutate(p);
  }

  async function cancel(id: string) {
    if (!confirm("هل أنت متأكد من إلغاء هذا الموعد؟")) return;
    setCancellingId(id);
    try {
      await cancelMutation.mutateAsync(id);
      showToast("تم إلغاء الموعد بنجاح.", "success");
      if (searchedPhone) lookupMutation.mutate(searchedPhone);
      qc.invalidateQueries({ queryKey: ["book-doctors"] });
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إلغاء الموعد."), "error");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="container-app py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold text-slate-900">تتبّع حجزي</h1>
          <p className="mt-1 text-slate-500">أدخل رقم الهاتف الذي استخدمته عند الحجز لعرض مواعيدك القادمة.</p>
        </div>

        <div className="card flex flex-col gap-3 p-6 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="رقم الهاتف"
              placeholder="0551234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(phone)}
            />
          </div>
          <Button onClick={() => search(phone)} loading={lookupMutation.isPending}>
            <Search className="ml-1.5 h-4 w-4" /> بحث
          </Button>
        </div>

        {searchedPhone && (
          <div className="mt-6">
            {lookupMutation.isPending ? (
              <Spinner label="جارٍ البحث..." />
            ) : lookupMutation.data && lookupMutation.data.length > 0 ? (
              <div className="space-y-3">
                {lookupMutation.data.map((a) => (
                  <div key={a.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-bold text-slate-800">
                        د. {a.doctor?.firstName} {a.doctor?.lastName} — {a.doctor?.specialty?.nameAr}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-4 w-4" />
                          {new Date(a.date).toLocaleDateString("ar-DZ")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {a.startTime}
                        </span>
                        <span className="badge bg-amber-100 text-amber-700">{STATUS_LABELS[a.status] ?? a.status}</span>
                      </div>
                    </div>
                    <Button variant="danger" onClick={() => cancel(a.id)} loading={cancellingId === a.id}>
                      <XCircle className="ml-1.5 h-4 w-4" /> إلغاء الموعد
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="لا توجد مواعيد قادمة" description="لم نجد أي حجوزات نشطة مرتبطة بهذا الرقم." />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
