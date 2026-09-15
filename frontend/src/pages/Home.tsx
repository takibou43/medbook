import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ShieldCheck, CalendarCheck, Users, Stethoscope, MapPin } from "lucide-react";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { useDoctors } from "../hooks/useDoctors";
import { DoctorCard } from "../components/DoctorCard";
import { Spinner } from "../components/ui/States";
import { useGeolocation } from "../hooks/useGeolocation";

const STEPS = [
  { icon: Search, title: "ابحث", desc: "اختر التخصص أو الولاية أو اسم الطبيب." },
  { icon: Stethoscope, title: "اختر الطبيب", desc: "اطّلع على الملف المهني والتقييمات." },
  { icon: CalendarCheck, title: "احجز موعدك", desc: "بدون تسجيل دخول — فقط الاسم والولاية والتخصص والوقت." },
  { icon: ShieldCheck, title: "تأكيد سريع", desc: "سيتواصل معك الطبيب أو العيادة لتأكيد الموعد." },
];

export default function Home() {
  const navigate = useNavigate();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const { data: featured, isLoading } = useDoctors({ page: 1 });

  const [specialtyId, setSpecialtyId] = useState("");
  const [wilayaId, setWilayaId] = useState("");
  const [q, setQ] = useState("");

  // موقع المريض (اختياري تمامًا) — لا يُطلب إلا بعد ضغط "السماح بالموقع" صراحةً، ولا
  // يُخزَّن في أي مكان (لا localStorage ولا قاعدة بيانات)، يُستعمل فقط لعرض "أطباء بالقرب
  // منك" وحساب المسافة/ترتيبها في هذه الجلسة.
  const geo = useGeolocation();
  const { data: nearby, isLoading: loadingNearby } = useDoctors(
    { lat: geo.coords?.lat, lng: geo.coords?.lng, page: 1 },
    geo.status === "granted" && Boolean(geo.coords)
  );
  const nearbyWithDistance = (nearby?.items ?? []).filter((d) => d.distanceKm != null).slice(0, 6);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (specialtyId) params.set("specialtyId", specialtyId);
    if (wilayaId) params.set("wilayaId", wilayaId);
    if (q) params.set("q", q);
    navigate(`/doctors?${params.toString()}`);
  }

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary-50 to-white">
        <div className="container-app py-16 text-center md:py-24">
          <h1 className="mx-auto max-w-2xl text-3xl font-extrabold text-slate-900 md:text-5xl">
            احجز موعدك الطبي <span className="text-primary-600">بسهولة</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-slate-600">
            منصة MedBook تربطك بأفضل الأطباء في جميع أنحاء الجزائر. ابحث، قارن، واحجز موعدك في دقائق.
          </p>

          <form onSubmit={handleSearch} className="card mx-auto mt-8 flex max-w-3xl flex-col gap-3 p-4 md:flex-row">
            <select className="input" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
              <option value="">كل التخصصات</option>
              {specialties?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameAr}
                </option>
              ))}
            </select>
            <select className="input" value={wilayaId} onChange={(e) => setWilayaId(e.target.value)}>
              <option value="">كل الولايات</option>
              {wilayas?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nameAr}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="ابحث عن طبيب أو تخصص..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="submit" className="btn-primary shrink-0">
              <Search className="h-4 w-4" />
              بحث
            </button>
          </form>

          <button onClick={() => navigate("/book")} className="mt-4 text-sm font-semibold text-primary-700 hover:underline">
            أو احجز موعدك مباشرة بدون بحث ←
          </button>
        </div>
      </section>

      {/* طلب إذن الموقع — اختياري، لا يُطلب تلقائيًا، ويختفي فور الاستجابة */}
      {geo.status === "idle" && (
        <section className="container-app -mt-6">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 text-center sm:flex-row sm:text-right">
            <MapPin className="h-6 w-6 shrink-0 text-primary-600" />
            <p className="flex-1 text-sm text-slate-700">
              اسمح لمادبوك باستخدام موقعك لعرض الأطباء والعيادات الأقرب إليك.
            </p>
            <div className="flex shrink-0 gap-2">
              <button onClick={geo.request} className="btn-primary px-4 py-2 text-sm">
                السماح بالموقع
              </button>
              <button onClick={geo.dismiss} className="btn-outline px-4 py-2 text-sm">
                ليس الآن
              </button>
            </div>
          </div>
        </section>
      )}
      {geo.status === "locating" && (
        <section className="container-app -mt-6">
          <p className="text-center text-sm text-slate-500">جارٍ تحديد موقعك...</p>
        </section>
      )}

      {/* أطباء بالقرب منك — تظهر فقط بعد السماح بالموقع وتوفّر أطباء لديهم إحداثيات مسجّلة */}
      {geo.status === "granted" && (
        <section className="container-app py-10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900">
              <MapPin className="h-6 w-6 text-primary-600" /> أطباء بالقرب منك
            </h2>
          </div>
          {loadingNearby ? (
            <Spinner />
          ) : nearbyWithDistance.length === 0 ? (
            <p className="text-sm text-slate-500">
              لا يوجد حاليًا أطباء مسجَّلون بموقع دقيق قريب منك — تصفّح كل الأطباء أدناه بدل ذلك.
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {nearbyWithDistance.map((d) => (
                <DoctorCard key={d.id} doctor={d} showNextSlot />
              ))}
            </div>
          )}
        </section>
      )}

      {/* How it works */}
      <section className="container-app py-14">
        <h2 className="mb-8 text-center text-2xl font-extrabold text-slate-900">كيف يعمل MedBook؟</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
                <step.icon className="h-6 w-6" />
              </div>
              <p className="mb-1 text-sm font-semibold text-primary-600">الخطوة {i + 1}</p>
              <h3 className="mb-1 font-bold text-slate-900">{step.title}</h3>
              <p className="text-sm text-slate-500">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Specialties */}
      <section className="bg-white py-14">
        <div className="container-app">
          <h2 className="mb-8 text-center text-2xl font-extrabold text-slate-900">التخصصات الأكثر طلبًا</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {specialties?.slice(0, 10).map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/doctors?specialtyId=${s.id}`)}
                className="card flex flex-col items-center gap-2 p-5 text-center transition hover:border-primary-300 hover:shadow-lg"
              >
                <Stethoscope className="h-6 w-6 text-primary-600" />
                <span className="text-sm font-semibold text-slate-800">{s.nameAr}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Featured doctors */}
      <section className="container-app py-14">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-2xl font-extrabold text-slate-900">أطباء مميزون</h2>
          <button onClick={() => navigate("/doctors")} className="text-sm font-semibold text-primary-700 hover:underline">
            عرض الكل
          </button>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured?.items.slice(0, 6).map((d) => (
              <DoctorCard key={d.id} doctor={d} />
            ))}
          </div>
        )}
      </section>

      {/* Trust */}
      <section className="bg-primary-600 py-12 text-white">
        <div className="container-app grid gap-6 text-center sm:grid-cols-3">
          <div>
            <Users className="mx-auto mb-2 h-7 w-7" />
            <p className="text-2xl font-extrabold">+20</p>
            <p className="text-sm text-primary-100">طبيب موثّق</p>
          </div>
          <div>
            <ShieldCheck className="mx-auto mb-2 h-7 w-7" />
            <p className="text-2xl font-extrabold">آمن 100%</p>
            <p className="text-sm text-primary-100">بيانات محمية بالكامل</p>
          </div>
          <div>
            <CalendarCheck className="mx-auto mb-2 h-7 w-7" />
            <p className="text-2xl font-extrabold">حجز فوري</p>
            <p className="text-sm text-primary-100">في أقل من دقيقتين</p>
          </div>
        </div>
      </section>
    </div>
  );
}
