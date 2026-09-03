import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarCheck, Users, CheckCircle2, XCircle, Star, QrCode, Copy } from "lucide-react";
import { api } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";
import { VerificationBadge } from "../../components/ui/Badge";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";

// رابط موقع الحجز الخاص بالمرضى — يُستخدم لبناء رابط/رمز QR خاص بكل طبيب.
// TODO: تحويله إلى متغيّر بيئة عند اعتماد نطاق مخصص للموقع مستقبلًا.
const PATIENT_SITE_URL = "https://medbook-alpha.vercel.app";

export default function DoctorDashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: async () => (await api.get("/doctor/dashboard")).data.data,
    // تحديث تلقائي للأرقام دون إعادة تحميل الصفحة (يتوقف عندما يكون التبويب في الخلفية).
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <Spinner />;

  const doctorId = user?.doctor?.id;
  const bookingUrl = doctorId ? `${PATIENT_SITE_URL}/?doctor=${doctorId}` : null;
  const qrImageUrl = bookingUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(bookingUrl)}`
    : null;

  async function copyBookingLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      showToast("تم نسخ رابط الحجز.", "success");
    } catch {
      showToast("تعذّر نسخ الرابط.", "error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-slate-900">لوحة تحكم الطبيب</h1>
        {stats && <VerificationBadge status={stats.verificationStatus} />}
      </div>

      {stats?.verificationStatus === "PENDING" && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ملفك المهني قيد المراجعة من طرف الإدارة. لن تظهر في نتائج بحث المرضى حتى تتم الموافقة.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="مواعيد اليوم" value={stats?.todayAppointments ?? 0} icon={CalendarClock} />
        <StatCard label="المواعيد القادمة" value={stats?.upcomingAppointments ?? 0} icon={CalendarCheck} />
        <StatCard label="إجمالي المرضى" value={stats?.totalPatients ?? 0} icon={Users} />
        <StatCard label="المواعيد المكتملة" value={stats?.completedAppointments ?? 0} icon={CheckCircle2} tone="green" />
        <StatCard label="المواعيد الملغاة" value={stats?.cancelledAppointments ?? 0} icon={XCircle} tone="red" />
        <StatCard label="متوسط التقييم" value={`${(stats?.avgRating ?? 0).toFixed(1)} (${stats?.reviewsCount ?? 0})`} icon={Star} tone="amber" />
      </div>

      {qrImageUrl && (
        <div className="card flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:items-center sm:text-right">
          <img src={qrImageUrl} alt="رمز QR للحجز" className="h-40 w-40 shrink-0 rounded-xl border border-slate-200 bg-white p-2" />
          <div className="flex-1 space-y-2">
            <p className="flex items-center justify-center gap-1.5 font-bold text-slate-800 sm:justify-start">
              <QrCode className="h-4 w-4" /> رمز QR الخاص بك
            </p>
            <p className="text-sm text-slate-500">
              اطبع هذا الرمز وضعه في عيادتك — يفتح المريض كاميرا هاتفه، يمسح الرمز، فيُختار اسمك تلقائيًا في صفحة الحجز ويكتب
              بياناته مباشرة دون بحث.
            </p>
            <button
              type="button"
              onClick={copyBookingLink}
              className="mx-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-primary-300 sm:mx-0"
            >
              <Copy className="h-3.5 w-3.5" /> نسخ رابط الحجز
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
