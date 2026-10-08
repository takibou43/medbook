import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../lib/api";
import { Doctor } from "../types";
import { RegionFilters } from "../components/booking/RegionFilters";
import { directionsUrl } from "../lib/patientPresentation";
interface Clinic { id: string; nameAr: string; address: string; phone?: string; description?: string; photoUrl?: string; city: { nameAr: string }; wilaya: { nameAr: string }; doctors?: Doctor[]; _count?: { doctors: number } }
export default function Clinics() {
  const { id } = useParams(); const [q, setQ] = useState(""); const [draft, setDraft] = useState(""); const [page, setPage] = useState(1);
  const [wilayaId, setWilayaId] = useState(""); const [cityId, setCityId] = useState("");
  const query = useQuery({ queryKey: ["public-clinics", id, q, page, wilayaId, cityId], queryFn: async () => {
    if (id) return { clinic: (await api.get<{ data: Clinic }>(`/clinics/${id}`)).data.data, items: [] as Clinic[], totalPages: 1 };
    const list = (await api.get<{ data: { items: Clinic[]; totalPages: number } }>("/clinics", { params: { q, page, wilayaId: wilayaId || undefined, cityId: cityId || undefined } })).data.data;
    return { ...list, clinic: null };
  }, retry: false });
  function search(e: FormEvent) { e.preventDefault(); setQ(draft.trim()); setPage(1); }
  const clinic = query.data?.clinic;
  return <section className="container-app py-8" dir="rtl">
    <Link to={id ? "/clinics" : "/"} className="inline-flex min-h-[48px] items-center text-primary-700">{id ? "كل العيادات" : "البحث عن طبيب والحجز"}</Link>
    <h1 className="my-4 text-2xl font-extrabold">{clinic?.nameAr || "العيادات"}</h1>
    {!id && <form onSubmit={search} className="mb-3 flex flex-wrap gap-2"><label className="flex-1"><span className="sr-only">اسم العيادة</span><input value={draft} onChange={e => setDraft(e.target.value)} placeholder="ابحث باسم العيادة" maxLength={100} className="input w-full" /></label><button className="btn-primary" type="submit">بحث</button></form>}
    {!id && <>
      <RegionFilters wilayaId={wilayaId} cityId={cityId} onChange={(w,c) => { setWilayaId(w); setCityId(c); setPage(1); }} />
      <button type="button" className="btn-outline mb-4" onClick={() => { setQ(""); setDraft(""); setWilayaId(""); setCityId(""); setPage(1); }}>مسح الفلاتر</button>
    </>}
    {query.isPending && <p>جارٍ تحميل العيادات…</p>}
    {query.isError && <div role="alert"><p>{apiErrorMessage(query.error, "تعذر تحميل العيادات.")}</p><button onClick={() => void query.refetch()} className="btn-outline mt-3">إعادة المحاولة</button></div>}
    {!id && query.data?.items.length === 0 && <p role="status">لا توجد عيادات متاحة تطابق البحث. جرّب منطقة أخرى أو امسح الفلاتر.</p>}
    {!id && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data?.items.map(c => <article key={c.id} className="card space-y-3 p-5">
      {c.photoUrl && <img src={c.photoUrl} alt="" loading="lazy" className="h-40 w-full rounded-xl object-cover" />}
      <h2 className="text-xl font-bold">{c.nameAr}</h2><p>{c.city.nameAr}، {c.wilaya.nameAr}</p><p>{c.address}</p><p>{c._count?.doctors} أطباء متاحون</p><Link to={`/clinics/${c.id}`} className="btn-primary">عرض أطباء العيادة</Link>
    </article>)}</div>}
    {!id && query.data && query.data.totalPages > 1 && <nav className="mt-6 flex items-center gap-4" aria-label="صفحات العيادات"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-outline">السابق</button><span>{page} / {query.data.totalPages}</span><button disabled={page >= query.data.totalPages} onClick={() => setPage(page + 1)} className="btn-outline">التالي</button></nav>}
    {clinic && <>
      <div className="card mb-6 space-y-3 p-5">{clinic.photoUrl && <img src={clinic.photoUrl} alt="" className="max-h-64 rounded-xl object-cover" />}<p>{clinic.description}</p><p>{clinic.address} · {clinic.city.nameAr}، {clinic.wilaya.nameAr}</p>{clinic.phone && <a className="btn-outline" href={`tel:${clinic.phone}`}>هاتف العيادة: <span dir="ltr">{clinic.phone}</span></a>}{directionsUrl(clinic.address, clinic.city.nameAr, clinic.wilaya.nameAr) && <a className="btn-outline ms-2" href={directionsUrl(clinic.address, clinic.city.nameAr, clinic.wilaya.nameAr)!} target="_blank" rel="noopener noreferrer">الاتجاهات</a>}</div>
      <h2 className="mb-4 text-xl font-bold">اختر طبيبك</h2>
      {clinic.doctors?.length === 0 && <p>لا يوجد أطباء متاحون للحجز حاليًا.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{clinic.doctors?.map(d => <article key={d.id} className="card space-y-3 p-5"><h3 className="font-bold">د. {d.firstName} {d.lastName}</h3><p>{d.specialty.nameAr}</p><p>{clinic.nameAr}</p><Link to={`/?doctor=${encodeURIComponent(d.id)}`} className="btn-primary">حجز مع هذا الطبيب</Link></article>)}</div>
    </>}
  </section>;
}
