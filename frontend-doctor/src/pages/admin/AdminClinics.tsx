import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Input, Select } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
interface Clinic { id: string; nameAr: string; address: string; owner: { email: string }; verificationStatus: string; subscriptionStatus: string; subscriptionExpiresAt: string | null; paidDoctorCount: number; _count: { doctors: number }; monthlyTotal: number }
export default function AdminClinics() {
  const qc = useQueryClient(); const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const query = useQuery({ queryKey: ["admin-clinics"], queryFn: async () => (await api.get<{ data: Clinic[] }>("/clinics/admin/list")).data.data });
  async function save(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(id); setError(""); setSuccess("");
    try { await api.patch(`/clinics/admin/${id}`, { verificationStatus: f.get("verificationStatus"), subscriptionStatus: f.get("subscriptionStatus"), paidDoctorCount: Number(f.get("paidDoctorCount")), subscriptionExpiresAt: f.get("expires") ? `${f.get("expires")}T23:59:59.999Z` : null }); await qc.invalidateQueries({ queryKey: ["admin-clinics"] }); setSuccess("تم حفظ مراجعة العيادة واشتراكها."); }
    catch (err) { setError(apiErrorMessage(err, "تعذر تحديث العيادة.")); } finally { setBusy(""); }
  }
  return <section className="space-y-5"><h1 className="text-2xl font-bold">العيادات والاشتراكات</h1>
    <p className="text-slate-600">اشتراك واحد لكل عيادة، بسعر 4,000 دج لكل طبيب شهريًا. تحقّق من الدفع قبل التفعيل؛ لا توجد بوابة دفع تلقائي.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}{success && <p role="status" className="text-primary-700">{success}</p>}
    {query.isPending && <p>جارٍ التحميل…</p>}{query.isError && <p role="alert">{apiErrorMessage(query.error, "تعذر تحميل العيادات.")}</p>}
    {query.data?.length === 0 && <p>لم تُسجل عيادات بعد.</p>}
    {query.data?.map(c => <form key={`${c.id}-${c.subscriptionExpiresAt}-${c.verificationStatus}-${c.subscriptionStatus}-${c.paidDoctorCount}`} onSubmit={e => void save(e, c.id)} className="card space-y-4 p-5">
      <h2 className="text-lg font-bold">{c.nameAr}</h2><p>{c.address}</p><p dir="ltr">{c.owner.email}</p>
      <p>{c._count.doctors} أطباء · المبلغ الشهري الحالي: <b>{c.monthlyTotal.toLocaleString("ar-DZ")} دج</b></p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select name="verificationStatus" label="مراجعة العيادة" defaultValue={c.verificationStatus}><option value="PENDING">قيد المراجعة</option><option value="VERIFIED">موثّقة</option><option value="REJECTED">مرفوضة</option></Select>
        <Select name="subscriptionStatus" label="حالة الاشتراك" defaultValue={c.subscriptionStatus}><option value="UNPAID">غير مفعّل</option><option value="ACTIVE">نشط</option><option value="EXPIRED">منتهي</option></Select>
        <Input name="paidDoctorCount" type="number" min={0} max={1000} label="عدد الأطباء المشمولين بالدفع" defaultValue={c.paidDoctorCount} required />
        <Input name="expires" type="date" label="تاريخ انتهاء الاشتراك" defaultValue={c.subscriptionExpiresAt?.slice(0, 10) || ""} />
      </div><Button type="submit" loading={busy === c.id}>حفظ المراجعة والاشتراك</Button>
    </form>)}
  </section>;
}
