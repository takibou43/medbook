import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { api, apiErrorMessage, selectAssistantDoctor, selectedAssistantDoctor } from "../lib/api";

export function AssistantDoctorSelector() {
  const { user } = useAuth();
  const doctors = useQuery({
    queryKey: ["assistant-doctors", user?.id],
    enabled: user?.role === "ASSISTANT",
    queryFn: async () => (await api.get<{ data: { id: string; firstName: string; lastName: string }[] }>("/assistant/doctors")).data.data,
  });
  if (doctors.isPending) return <p role="status">جارٍ تحميل أطباء العيادة…</p>;
  if (doctors.isError) return <p role="alert">{apiErrorMessage(doctors.error)}</p>;
  const selected = selectedAssistantDoctor() ?? user?.assistant?.doctor?.id ?? "";
  return <label className="block rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold">
    الطبيب الذي تدير مواعيده
    <select className="mt-2 w-full rounded-lg border border-slate-300 p-2" value={selected} onChange={e => {
      selectAssistantDoctor(e.target.value);
      // A fresh page discards all cached data and pending UI for the previous doctor.
      window.location.reload();
    }}>
      <option value="" disabled>اختر طبيبًا من عيادتك</option>
      {!doctors.data.some(d => d.id === selected) && selected && <option value={selected} disabled>اختر طبيبًا متاحًا</option>}
      {doctors.data.map(d => <option key={d.id} value={d.id}>د. {d.firstName} {d.lastName}</option>)}
    </select>
  </label>;
}
