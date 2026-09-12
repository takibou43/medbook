import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarCheck, CalendarDays, Users, CheckCircle2, XCircle, Star, QrCode, Copy, Download, Printer, AlertTriangle, Wallet } from "lucide-react";
import { api } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";
import { VerificationBadge } from "../../components/ui/Badge";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";

// رابط موقع الحجز الخاص بالمرضى — يُستخدم لبناء رابط/رمز QR خاص بكل طبيب.
// TODO: تحويله إلى متغيّر بيئة عند اعتماد نطاق مخصص للموقع مستقبلًا.
const PATIENT_SITE_URL = "https://medbook-alpha.vercel.app";

// تاريخ اليوم بتوقيت الجزائر (UTC+1) بصيغة YYYY-MM-DD — يُستخدم لبناء رابط بطاقة
// "مواعيد اليوم" في صفحة المواعيد (نفس منطق الإزاحة الزمنية المستخدم في بقية الموقع).
function algeriaTodayIso(): string {
  const algeriaNow = new Date(Date.now() + 60 * 60000);
  return algeriaNow.toISOString().slice(0, 10);
}

/**
 * رابط صورة رمز QR. يُرمَّز داخله رابط الحجز العام للطبيب فقط — لا اسم مريض ولا رقم
 * هاتف ولا أي بيانات طبية ولا رمز دخول. ثابت ما دام معرّف الطبيب العام ثابتًا، فلا
 * يتغيّر عند تعديل اسم الطبيب أو بياناته. نستعمل خدمة التوليد نفسها المستخدمة أصلًا
 * في المشروع (بلا مكتبة جديدة).
 */
function qrUrlFor(bookingUrl: string, format: "png" | "svg", size: number, margin: number): string {
  const params = new URLSearchParams({
    size: `${size}x${size}`,
    margin: String(margin),
    format,
    data: bookingUrl,
  });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

/** نفس تنسيق العملة المستعمل في بقية اللوحة. */
function formatDzd(value: number): string {
  return `${(value ?? 0).toLocaleString("ar-DZ")} دج`;
}

/**
 * الدخل التقديري في بطاقة واحدة بقيمتين: اليوم وهذا الشهر. القيمتان تأتيان من الخادم
 * محسوبتين من المواعيد المكتملة (COMPLETED) وحدها × سعر استشارة الطبيب.
 */
function RevenueCard({ today, month, fee }: { today: number; month: number; fee: number }) {
  return (
    <section className="card p-4 sm:p-5" aria-label="الدخل التقديري">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700">
          <Wallet className="h-[18px] w-[18px]" />
        </span>
        <h2 className="text-base font-bold text-slate-800">الدخل التقديري</h2>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-4">
        <div className="min-w-0 rounded-xl bg-green-50 p-3">
          <p className="text-xs font-semibold text-green-800">اليوم</p>
          <p className="mt-0.5 truncate text-lg font-extrabold tabular-nums text-slate-900 sm:text-2xl">{formatDzd(today)}</p>
        </div>
        <div className="min-w-0 rounded-xl bg-green-50 p-3">
          <p className="text-xs font-semibold text-green-800">هذا الشهر</p>
          <p className="mt-0.5 truncate text-lg font-extrabold tabular-nums text-slate-900 sm:text-2xl">{formatDzd(month)}</p>
        </div>
      </div>

      <p className="mt-2.5 text-[11px] leading-4 text-slate-500">يُحسب حسب المواعيد المكتملة وسعر الاستشارة الحالي.</p>
      {fee === 0 && <p className="mt-1 text-[11px] leading-4 text-amber-700">أضف سعر الاستشارة في إعدادات ملفك لحساب الدخل.</p>}
    </section>
  );
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  // الصيغة الجاري تحميلها حاليًا — لمنع النقر المتكرر وإظهار حالة الزر.
  const [qrDownloading, setQrDownloading] = useState<"png" | "svg" | null>(null);

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
  const qrImageUrl = bookingUrl ? qrUrlFor(bookingUrl, "png", 320, 8) : null;

  async function copyBookingLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      showToast("تم نسخ رابط الحجز.", "success");
    } catch {
      showToast("تعذّر نسخ الرابط.", "error");
    }
  }

  /**
   * تحميل الرمز كملف قابل للطباعة. الصورة تُجلب كـ blob لأن السمة download لا تعمل على
   * رابط من نطاق آخر — والخدمة تُرسل Access-Control-Allow-Origin: * فينجح الجلب.
   * PNG بدقة 1024 للطباعة، وSVG متجهي لا يفقد الحدّة في أي مقاس.
   */
  async function downloadQr(format: "png" | "svg") {
    if (!bookingUrl || !doctorId || qrDownloading) return;
    setQrDownloading(format);
    try {
      const res = await fetch(qrUrlFor(bookingUrl, format, format === "png" ? 1024 : 512, 16));
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `madbook-qr-${doctorId}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      showToast(`تم تحميل الرمز بصيغة ${format.toUpperCase()}.`, "success");
    } catch {
      showToast("تعذّر تحميل الرمز. تحقّق من اتصالك بالإنترنت وأعد المحاولة.", "error");
    } finally {
      setQrDownloading(null);
    }
  }

  function printQrCode() {
    if (!qrImageUrl) return;
    const doctorName = user?.doctor ? "د. " + user.doctor.firstName + " " + user.doctor.lastName : "";
    const printWindow = window.open("", "_blank", "width=480,height=640");
    if (!printWindow) {
      showToast("يرجى السماح بالنوافذ المنبثقة للطباعة.", "error");
      return;
    }
    const html =
      "<!DOCTYPE html><html dir='rtl' lang='ar'><head><meta charset='utf-8' />" +
      "<title>رمز QR للحجز</title><style>" +
      "*{box-sizing:border-box;}" +
      "body{font-family:Tahoma,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:32px;text-align:center;}" +
      "h1{font-size:20px;margin:0 0 4px;}" +
      "p.sub{color:#555;margin:0 0 24px;font-size:14px;}" +
      "img{width:320px;height:320px;border:1px solid #e2e8f0;border-radius:16px;padding:12px;}" +
      "p.instructions{margin-top:24px;font-size:14px;color:#333;max-width:320px;line-height:1.6;}" +
      ".brand{margin-top:32px;font-size:12px;color:#999;}" +
      "@media print{body{padding:0;}}" +
      "</style></head><body>" +
      "<h1>MedBook" + (doctorName ? " — " + doctorName : "") + "</h1>" +
      "<p class='sub'>امسح الرمز لحجز موعد</p>" +
      "<img src='" + qrImageUrl + "' alt='QR' />" +
      "<p class='instructions'>لحجز موعد، امسح الرمز بكاميرا هاتفك.</p>" +
      "<p class='brand' dir='ltr'>" + bookingUrl + "</p>" +
      "</body></html>";
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

  // عدّ الأيام المتبقية من الاشتراك (أو التجربة المجانية). نعرض التنبيه طوال المدة لا في
  // آخر أيامها فقط، حتى يعرف الطبيب منذ اليوم الأول أن المدة محدودة ولا يُفاجأ بتوقف ظهوره.
  const subscriptionEndsAt = user?.doctor?.subscriptionExpiresAt ? new Date(user.doctor.subscriptionExpiresAt) : null;
  const validEnd = subscriptionEndsAt && !isNaN(subscriptionEndsAt.getTime()) ? subscriptionEndsAt : null;
  const daysLeft = validEnd ? Math.max(0, Math.ceil((validEnd.getTime() - Date.now()) / 86400000)) : null;

  return (
    <div className="space-y-6">
      {daysLeft !== null && validEnd && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">
            {daysLeft > 0
              ? "اشتراكك المجاني ينتهي يوم " + validEnd.toLocaleDateString("ar-DZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) + " — متبقٍ " + daysLeft + (daysLeft === 1 ? " يوم" : " يومًا") + ". بعده يتوقف ظهورك للمرضى حتى تجديد الاشتراك."
              : "انتهت مدة اشتراكك المجاني. تواصل مع إدارة المنصة لتجديد الاشتراك والعودة إلى الظهور للمرضى."}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-slate-900">لوحة تحكم الطبيب</h1>
        {stats && <VerificationBadge status={stats.verificationStatus} />}
      </div>

      {stats?.verificationStatus === "PENDING" && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ملفك المهني قيد المراجعة من طرف الإدارة. لن تظهر في نتائج بحث المرضى حتى تتم الموافقة.
        </div>
      )}

      <RevenueCard
        today={stats?.estimatedRevenueToday ?? 0}
        month={stats?.estimatedRevenueMonth ?? 0}
        fee={stats?.consultationFee ?? 0}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
        <StatCard label="مواعيد اليوم" value={stats?.todayAppointments ?? 0} icon={CalendarClock} to={`/appointments?status=ALL&date=${algeriaTodayIso()}`} />
        <StatCard label="المواعيد القادمة" value={stats?.upcomingAppointments ?? 0} icon={CalendarCheck} to="/appointments?status=CONFIRMED" />
        <StatCard label="إجمالي المرضى" value={stats?.totalPatients ?? 0} sub="مرضى مختلفون" icon={Users} to="/patients" />
        <StatCard label="المواعيد المكتملة" value={stats?.completedAppointments ?? 0} icon={CheckCircle2} tone="green" to="/appointments?status=COMPLETED" />
        <StatCard label="المواعيد الملغاة" value={stats?.cancelledAppointments ?? 0} icon={XCircle} tone="red" to="/appointments?status=CANCELLED" />
        <StatCard
          label="متوسط التقييم"
          value={`${(stats?.avgRating ?? 0).toFixed(1)} / 5`}
          sub={(stats?.reviewsCount ?? 0) > 0 ? `من أصل ${stats?.reviewsCount} تقييم` : "لا توجد تقييمات بعد"}
          icon={Star}
          tone="amber"
        />
        <StatCard label="مواعيد هذا الشهر" value={stats?.monthlyAppointments ?? 0} icon={CalendarDays} to="/appointments?status=ALL" />
        <StatCard
          label="نسبة الغياب"
          value={`${stats?.noShowRate ?? 0}%`}
          sub="من المواعيد المنتهية"
          icon={AlertTriangle}
          tone={((stats?.noShowRate ?? 0) > 20) ? "red" : "amber"}
          to="/appointments?status=NO_SHOW"
        />
      </div>

      {qrImageUrl && bookingUrl && (
        <section className="card p-4 sm:p-6" aria-label="رمز الحجز QR">
          <h2 className="flex items-center gap-1.5 font-bold text-slate-800">
            <QrCode className="h-4 w-4 shrink-0" /> رمز الحجز QR
          </h2>

          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
            <figure className="shrink-0 text-center">
              <img
                src={qrImageUrl}
                alt="رمز QR لصفحة الحجز"
                className="h-44 w-44 rounded-xl border border-slate-200 bg-white p-3 sm:h-48 sm:w-48"
              />
              <figcaption className="mt-1.5 text-[11px] text-slate-500">امسح الرمز لفتح صفحة الحجز</figcaption>
            </figure>

            {/* w-full ضروري: الحاوية على الهاتف flex-col مع items-center، فبدونه يأخذ هذا
                العمود عرض محتواه (رابط الحجز الطويل) فيتجاوز عرض الشاشة ويُحدث تمريرًا
                أفقيًا للصفحة كاملة. */}
            <div className="w-full min-w-0 flex-1 space-y-3 text-center sm:w-auto sm:text-right">
              <p className="text-sm leading-relaxed text-slate-600">
                اطبع هذا الرمز وضعه في بوابة العيادة، ليتمكن المرضى من تصويره وفتح صفحة الحجز مباشرة.
              </p>

              <p
                dir="ltr"
                className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-xl bg-slate-50 px-3 py-2 text-left text-xs text-slate-500"
                title={bookingUrl}
              >
                {bookingUrl}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <button
                  type="button"
                  onClick={() => downloadQr("png")}
                  disabled={qrDownloading !== null}
                  className="flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  {qrDownloading === "png" ? "جارٍ التحميل..." : "تحميل رمز QR (PNG)"}
                </button>
                <button
                  type="button"
                  onClick={() => downloadQr("svg")}
                  disabled={qrDownloading !== null}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-primary-300 disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  {qrDownloading === "svg" ? "جارٍ التحميل..." : "SVG"}
                </button>
                <button
                  type="button"
                  onClick={copyBookingLink}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-primary-300"
                >
                  <Copy className="h-3.5 w-3.5" /> نسخ الرابط
                </button>
                <button
                  type="button"
                  onClick={printQrCode}
                  className="flex items-center gap-1.5 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 transition hover:border-primary-300"
                >
                  <Printer className="h-3.5 w-3.5" /> طباعة الرمز
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
