import { FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { DoctorProfileFields, doctorFromForm } from "./ClinicForms";
export default function ClinicDoctorInvite() {
  const { token } = useParams(); const { user, registerClinicDoctor, refreshMe } = useAuth(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["clinic-invite", token], queryFn: async () => (await api.get<{ data: { email: string; clinicName: string } }>(`/clinics/invites/${token}`)).data.data, retry: false });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError("");
    try {
      if (user) { await api.post("/clinics/invites/accept", { token }); await refreshMe(); }
      else await registerClinicDoctor({ token, password: form.get("password"), doctor: doctorFromForm(form) });
      navigate("/");
    } catch (err) { setError(apiErrorMessage(err, "تعذر قبول الدعوة.")); } finally { setBusy(false); }
  }
  if (query.isPending) return <p className="p-8">جارٍ التحقق من الدعوة…</p>;
  if (query.isError) return <p role="alert" className="p-8 text-red-600">{apiErrorMessage(query.error, "الدعوة غير صالحة.")}</p>;
  return <main className="container-app mx-auto max-w-lg py-10" dir="rtl">
    <h1 className="text-2xl font-bold">انضم إلى {query.data.clinicName}</h1><p className="my-4">الدعوة مخصصة للبريد: <b dir="ltr">{query.data.email}</b></p>
    <p className="mb-4 text-slate-600">يرتبط الطبيب بعيادة واحدة، ويُدرج اشتراكه ضمن اشتراك العيادة.</p>
    <form onSubmit={submit} className="card space-y-4 p-6">
      {user ? <p>ستربط هذه الدعوة ملفك الطبي الحالي بالعيادة، ويصبح اشتراك الحجز تابعًا لاشتراكها.</p> : <><DoctorProfileFields /><Input name="password" label="كلمة مرور حساب الطبيب الجديد" type="password" minLength={8} required /></>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <Button type="submit" loading={busy} disabled={!!user && user.role !== "DOCTOR"}>قبول الدعوة</Button>
    </form>
    {!user && <p className="mt-4">لديك حساب طبيب؟ <Link className="text-primary-700" to="/login">سجّل الدخول ثم افتح رابط الدعوة مجددًا.</Link></p>}
  </main>;
}
