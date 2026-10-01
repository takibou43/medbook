import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { api } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { FollowUpModal, type FollowUpContext } from "../../components/FollowUpModal";
import { RELATIONSHIP_LABELS } from "../../lib/features";

export default function DoctorPatients() {
  const { data: patients, isLoading } = useQuery({
    queryKey: ["doctor-patients"],
    queryFn: async () => (await api.get("/doctor/patients")).data.data,
  });
  // «برمجة موعد عودة» من ملف المريض: مرجعه آخر موعد غير ملغى لهذا المستفيد عندك.
  const [followUpCtx, setFollowUpCtx] = useState<FollowUpContext | null>(null);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">مرضاي</h1>

      <FollowUpModal open={Boolean(followUpCtx)} ctx={followUpCtx} onClose={() => setFollowUpCtx(null)} />

      {isLoading ? (
        <Spinner />
      ) : patients && patients.length > 0 ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">الاسم</th>
                <th className="px-4 py-3 font-semibold">البريد الإلكتروني</th>
                <th className="px-4 py-3 font-semibold">الهاتف</th>
                <th className="px-4 py-3 font-semibold">عدد المواعيد</th>
                <th className="px-4 py-3 font-semibold">آخر زيارة</th>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">إجراءات</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map((p: any, i: number) => (
                <tr key={`${p.patientId ?? "guest"}-${p.familyMemberId ?? "self"}-${i}`}>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {p.firstName} {p.lastName}
                    {p.isGuest && <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">بدون حساب</span>}
                    {p.familyMemberId && p.beneficiary?.relationship && (
                      <span className="mr-2 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-800">
                        {RELATIONSHIP_LABELS[p.beneficiary.relationship as keyof typeof RELATIONSHIP_LABELS]}
                        {p.accountHolderName ? ` — حساب ${p.accountHolderName}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.email}</td>
                  <td className="px-4 py-3 text-slate-600">{p.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{p.totalAppointments}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(p.lastVisit).toLocaleDateString("ar-DZ")}</td>
                  <td className="px-4 py-3">
                    {p.lastAppointmentId && (
                      <Button
                        variant="outline"
                        className="whitespace-nowrap"
                        onClick={() =>
                          setFollowUpCtx({
                            parentAppointmentId: p.lastAppointmentId,
                            beneficiaryName: `${p.firstName} ${p.lastName}`,
                            familyMemberId: p.familyMemberId ?? null,
                            accountHolderName: p.accountHolderName ?? null,
                          })
                        }
                      >
                        <CalendarPlus className="h-4 w-4" /> برمجة موعد عودة
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="لا يوجد مرضى بعد" />
      )}
    </div>
  );
}
