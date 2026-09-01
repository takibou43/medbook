import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";

export default function DoctorPatients() {
  const { data: patients, isLoading } = useQuery({
    queryKey: ["doctor-patients"],
    queryFn: async () => (await api.get("/doctor/patients")).data.data,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">مرضاي</h1>

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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map((p: any, i: number) => (
                <tr key={p.patientId ?? `guest-${i}`}>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {p.firstName} {p.lastName}
                    {p.isGuest && <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">بدون حساب</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.email}</td>
                  <td className="px-4 py-3 text-slate-600">{p.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{p.totalAppointments}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(p.lastVisit).toLocaleDateString("ar-DZ")}</td>
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
