import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Clock,
  CheckCircle2,
  Star,
  Stethoscope,
  MapPin,
  Search,
  X,
  LocateFixed,
  Baby,
  HeartPulse,
  Eye,
  Smile,
  Sparkles,
  Flower2,
  Scissors,
  Brain,
  Ear,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Spinner, EmptyState } from "../components/ui/States";
import { useToast } from "../components/ui/Toast";
import { Doctor, Specialty, Wilaya } from "../types";

// مطابقة مفتاح الأيقونة المخزّن لكل تخصص (Specialty.icon) برمز بصري —
// لا يوجد أيقونة "سن" جاهزة في مكتبة lucide-react فاستُعيض عنها بـ Smile.
const SPECIALTY_ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  baby: Baby,
  "heart-pulse": HeartPulse,
  eye: Eye,
  tooth: Smile,
  sparkles: Sparkles,
  flower: Flower2,
  scissors: Scissors,
  brain: Brain,
  ear: Ear,
};

function specialtyIcon(icon?: string | null): LucideIcon {
  return (icon && SPECIALTY_ICONS[icon]) || Stethoscope;
}

// عنوان عيادة الطبيب الظاهر للمريض عند الحجز — عنوان العيادة أدق من العنوان الشخصي
// للطبيب إن وُجدت عيادة مسجَّلة، وإلا نستعمل عنوان الطبيب نفسه إن أدخله.
function doctorAddress(d: Doctor): string | null {
  return d.clinic?.address || d.address || null;
}

// إحداثيات تقريبية لمركز كل ولاية (مدينة الولاية) — تُستخدم فقط لتحديد أقرب ولاية
// من الولايات التي يوجد بها أطباء فعليًا بواسطة GPS الهاتف (لا تحتاج دقة الحدود
// الإدارية، فالمقارنة تكون غالبًا بين عدد قليل من الولايات المتوفرة حاليًا).
// المصدر: مدن الولايات الرسمية (إحداثيات مدينة الولاية نفسها).
const WILAYA_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "01": { lat: 27.8742, lng: -0.2939 }, // أدرار
  "02": { lat: 36.1647, lng: 1.3317 }, // الشلف
  "03": { lat: 33.8, lng: 2.865 }, // الأغواط
  "04": { lat: 35.8706, lng: 7.115 }, // أم البواقي
  "05": { lat: 35.55, lng: 6.1667 }, // باتنة
  "06": { lat: 36.7511, lng: 5.0642 }, // بجاية
  "07": { lat: 34.85, lng: 5.7333 }, // بسكرة
  "08": { lat: 31.6164, lng: -2.2183 }, // بشار
  "09": { lat: 36.4722, lng: 2.8333 }, // البليدة
  "10": { lat: 36.3783, lng: 3.8925 }, // البويرة
  "11": { lat: 22.785, lng: 5.5228 }, // تمنراست
  "12": { lat: 35.4, lng: 8.1167 }, // تبسة
  "13": { lat: 34.8828, lng: -1.3167 }, // تلمسان
  "14": { lat: 35.3667, lng: 1.3167 }, // تيارت
  "15": { lat: 36.7169, lng: 4.0497 }, // تيزي وزو
  "16": { lat: 36.7764, lng: 3.0586 }, // الجزائر
  "17": { lat: 34.6667, lng: 3.25 }, // الجلفة
  "18": { lat: 36.8206, lng: 5.7667 }, // جيجل
  "19": { lat: 36.19, lng: 5.41 }, // سطيف
  "20": { lat: 34.8303, lng: 0.1517 }, // سعيدة
  "21": { lat: 36.8667, lng: 6.9 }, // سكيكدة
  "22": { lat: 35.2, lng: -0.6333 }, // سيدي بلعباس
  "23": { lat: 36.9, lng: 7.7667 }, // عنابة
  "24": { lat: 36.4619, lng: 7.4258 }, // قالمة
  "25": { lat: 36.365, lng: 6.6147 }, // قسنطينة
  "26": { lat: 36.2675, lng: 2.75 }, // المدية
  "27": { lat: 35.9333, lng: 0.0903 }, // مستغانم
  "28": { lat: 35.7058, lng: 4.5419 }, // المسيلة
  "29": { lat: 35.4, lng: 0.1333 }, // معسكر
  "30": { lat: 31.95, lng: 5.3167 }, // ورقلة
  "31": { lat: 35.6969, lng: -0.6331 }, // وهران
  "32": { lat: 33.6831, lng: 1.0192 }, // البيض
  "33": { lat: 26.508, lng: 8.4829 }, // إليزي
  "34": { lat: 36.0667, lng: 4.7667 }, // برج بوعريريج
  "35": { lat: 36.7594, lng: 3.4728 }, // بومرداس
  "36": { lat: 36.7669, lng: 8.3136 }, // الطارف
  "37": { lat: 27.6753, lng: -8.1286 }, // تندوف
  "38": { lat: 35.6072, lng: 1.8106 }, // تسمسيلت
  "39": { lat: 33.3683, lng: 6.8675 }, // الوادي
  "40": { lat: 35.4167, lng: 7.1333 }, // خنشلة
  "41": { lat: 36.2864, lng: 7.9511 }, // سوق أهراس
  "42": { lat: 36.5942, lng: 2.443 }, // تيبازة
  "43": { lat: 36.4481, lng: 6.2622 }, // ميلة
  "44": { lat: 36.2583, lng: 1.9583 }, // عين الدفلى
  "45": { lat: 33.2678, lng: -0.3111 }, // النعامة
  "46": { lat: 35.3044, lng: -1.14 }, // عين تموشنت
  "47": { lat: 32.4833, lng: 3.6667 }, // غرداية
  "48": { lat: 35.7372, lng: 0.5558 }, // غليزان
  "49": { lat: 29.25, lng: 0.2333 }, // تيميمون
  "50": { lat: 21.3289, lng: 0.9542 }, // برج باجي مختار
  "51": { lat: 34.4167, lng: 5.0667 }, // أولاد جلال
  "52": { lat: 30.1317, lng: -2.1692 }, // بني عباس
  "53": { lat: 27.195, lng: 2.4825 }, // عين صالح
  "54": { lat: 19.5686, lng: 5.7722 }, // عين قزام
  "55": { lat: 33.1, lng: 6.0667 }, // تقرت
  "56": { lat: 24.555, lng: 9.4853 }, // جانت
  "57": { lat: 33.9506, lng: 5.9242 }, // المغير
  "58": { lat: 30.6, lng: 2.9 }, // المنيعة
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface BookingForm {
  firstName: string;
  lastName: string;
  phone: string;
  wilayaId: string;
  specialtyId: string;
}

interface NextSlot {
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

// تسمية مختصرة وودّية لأقرب دور معروض في قائمة الأطباء ("اليوم"، "غدًا"، أو التاريخ).
function formatSlotLabel(dateStr: string, startTime: string): string {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) return `اليوم ${startTime}`;
  if (diffDays === 1) return `غدًا ${startTime}`;
  return `${target.toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" })} — ${startTime}`;
}

// فرق الدقائق بين وقتي بداية ونهاية الموعد الفعليَّين (بصيغة HH:mm) كما سجّلهما الخادم —
// نستخدمها كمدة دقيقة للحدث في التقويم بدل افتراض مدة ثابتة.
function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}
// روابط "أضِف إلى التقويم" — تُنشأ بالكامل في المتصفح من بيانات الموعد الفعلية (بلا خادم
// إضافي وبلا أي مكتبة جديدة): رابط ICS قابل للتنزيل يفتح تطبيق التقويم الافتراضي في الهاتف
// (يعمل على Android وiOS معًا بلا اتصال إنترنت لحظة الإضافة)، ورابط Google Calendar كبديل
// سريع. كلاهما بتوقيت الجزائر UTC+1 (بلا توقيت صيفي)، ويحملان تذكيرين: قبل ساعة وقبل 10 دقائق.
function buildCalendarLinks(params: {
  doctorName: string;
  patientName: string;
  clinicPhone: string | null;
  address: string | null;
  dateStr: string;
  startTime: string;
  durationMinutes: number;
}) {
  const { doctorName, patientName, clinicPhone, address, dateStr, startTime, durationMinutes } = params;
  // نحلّل dateStr بمرونة: قد يصل كسلسلة "YYYY-MM-DD" فقط (كما في معاينة الدور) أو كطابع
  // زمني ISO كامل بالحرف T (كما في استجابة إنشاء الموعد الفعلي). تقسيم النص يدويًا بـ"-"
  // يفشل مع الطابع الكامل (كان هذا سبب انهيار الصفحة فورًا بعد نجاح الحجز)، لذا نمرّ دائمًا
  // عبر new Date() ونقرأ مكوّناته بتوقيت UTC مباشرة، بصرف النظر عن الصيغة الواردة.
  const baseDate = new Date(dateStr);
  const [h, mi] = startTime.split(":").map(Number);
  const ALGERIA_OFFSET_MS = 60 * 60000;
  const startUtc = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), h, mi) - ALGERIA_OFFSET_MS
  );
  const endUtc = new Date(startUtc.getTime() + Math.max(durationMinutes, 5) * 60000);
  const fmt = (dt: Date) => dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const title = `موعد طبي مع الدكتور ${doctorName}`;
  const descriptionParts = [
    "موعد طبي محجوز عبر MedBook",
    `الطبيب: د. ${doctorName}`,
    `المريض: ${patientName}`,
    clinicPhone ? `هاتف العيادة: ${clinicPhone}` : null,
  ].filter((p): p is string => Boolean(p));
  const description = descriptionParts.join(" | ");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MedBook//Booking//AR",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@medbook.dz`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(startUtc)}`,
    `DTEND:${fmt(endUtc)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    address ? `LOCATION:${address}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:تذكير بموعدك الطبي بعد ساعة",
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:تذكير بموعدك الطبي بعد 10 دقائق",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  const icsUrl = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${fmt(startUtc)}/${fmt(endUtc)}` +
    `&details=${encodeURIComponent(description)}` +
    (address ? `&location=${encodeURIComponent(address)}` : "");

  return { icsUrl, googleUrl };
}

export default function BookAppointment() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();

  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  // تفاصيل الحجز المؤكَّد الأخير — تُعرض في نافذة تأكيد (الطبيب والموعد والعنوان) وتُستخدم
  // لبناء رابط "أضِف إلى التقويم". نحتفظ بها هنا (وليس فقط عبر selectedDoctor) لأن
  // selectedDoctor يُصفَّر عند إغلاق نافذة التأكيد بينما تبقى هذه البيانات ثابتة.
  const [confirmed, setConfirmed] = useState<{
    date: string;
    startTime: string;
    doctorName: string;
    address: string | null;
    patientName: string;
    clinicPhone: string | null;
    durationMinutes: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [debouncedNameQuery, setDebouncedNameQuery] = useState("");
  // البحث بالاسم أصبح خلف أيقونة صغيرة أعلى الصفحة بدل حقل ثابت داخل الاستمارة —
  // أخف بصريًا ولا يزاحم بقية الحقول لمن لا يحتاجه.
  const [searchOpen, setSearchOpen] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BookingForm>({
    defaultValues: { wilayaId: "", specialtyId: "" },
  });

  const wilayaIdRaw = watch("wilayaId");
  const specialtyId = watch("specialtyId");

  // نجلب كل الأطباء الموثّقين مرة واحدة (بلا فلترة)، ثم نشتق منهم محليًا الولايات
  // والتخصصات المتوفرة فعليًا. هكذا لا تظهر ولاية أو تخصص للمريض إلا إذا اشترك فيه
  // طبيب حقيقي — تُضاف/تُزال تلقائيًا دون أي تعديل يدوي في الكود مستقبلًا.
  // ملاحظة: الجلب محدود بـ 50 طبيبًا (حد الخادم)؛ يكفي للمرحلة الحالية وسيُعاد النظر
  // فيه (تصفح مقسّم على صفحات) عند نمو عدد الأطباء المشتركين.
  const { data: allDoctors, isFetching: loadingDoctors } = useQuery({
    queryKey: ["book-doctors-all"],
    queryFn: async () => (await api.get<{ data: { items: Doctor[] } }>("/doctors", { params: { pageSize: 50 } })).data.data.items,
  });

  const availableWilayas = useMemo(() => {
    const map = new Map<string, Wilaya>();
    for (const d of allDoctors ?? []) {
      if (!map.has(d.wilaya.id)) map.set(d.wilaya.id, d.wilaya);
    }
    return Array.from(map.values());
  }, [allDoctors]);

  // إن كانت هناك ولاية واحدة فقط متاحة، تُختار تلقائيًا دون إزعاج المريض باختيار لا معنى له.
  const effectiveWilayaId = wilayaIdRaw || (availableWilayas.length === 1 ? availableWilayas[0].id : "");

  useEffect(() => {
    if (!wilayaIdRaw && availableWilayas.length === 1) {
      setValue("wilayaId", availableWilayas[0].id, { shouldValidate: true });
    }
  }, [availableWilayas, wilayaIdRaw, setValue]);

  const wilayaDoctors = useMemo(
    () => (allDoctors ?? []).filter((d) => d.wilaya.id === effectiveWilayaId),
    [allDoctors, effectiveWilayaId]
  );

  const availableSpecialties = useMemo(() => {
    const map = new Map<string, Specialty>();
    for (const d of wilayaDoctors) {
      if (!map.has(d.specialtyId)) map.set(d.specialtyId, d.specialty);
    }
    return Array.from(map.values());
  }, [wilayaDoctors]);

  const doctorsEnabled = Boolean(effectiveWilayaId && specialtyId);
  const doctors = useMemo(() => wilayaDoctors.filter((d) => d.specialtyId === specialtyId), [wilayaDoctors, specialtyId]);

  // اختيار ولاية/تخصص/طبيب صراحةً من المستخدم — كل خطوة تُلغي ما يليها فقط (وليس أي
  // تغيير برمجي آخر)، لتفادي تعارضها مع الاختيار المباشر عبر البحث بالاسم أو رمز QR.
  function chooseWilaya(id: string) {
    setValue("wilayaId", id, { shouldValidate: true });
    setValue("specialtyId", "");
    setSelectedDoctor(null);
  }

  function chooseSpecialty(id: string) {
    setValue("specialtyId", id, { shouldValidate: true });
    setSelectedDoctor(null);
  }

  // اختيار طبيب مباشرة (من البحث بالاسم أو من رابط رمز QR) — يضبط الولاية والتخصص
  // معًا ليتوافقا مع الطبيب المختار دون المرور بخطوات الاختيار اليدوية.
  function chooseDoctorDirectly(d: Doctor) {
    setValue("wilayaId", d.wilaya.id, { shouldValidate: true });
    setValue("specialtyId", d.specialtyId, { shouldValidate: true });
    setSelectedDoctor(d);
    setNameQuery("");
  }

  // تحديد أقرب ولاية (من الولايات المتوفرة فعليًا) عبر GPS الهاتف — زر اختياري،
  // لا يُطلب إذن الموقع إلا عند الضغط عليه صراحةً.
  function useMyLocation() {
    if (!navigator.geolocation) {
      showToast("متصفحك لا يدعم تحديد الموقع.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        let nearest: Wilaya | null = null;
        let nearestDist = Infinity;
        for (const w of availableWilayas) {
          const c = WILAYA_CENTROIDS[w.code];
          if (!c) continue;
          const dist = haversineKm(latitude, longitude, c.lat, c.lng);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = w;
          }
        }
        if (nearest) {
          chooseWilaya(nearest.id);
          showToast(`تم اختيار ولاية ${nearest.nameAr} كأقرب ولاية لموقعك.`, "success");
        } else {
          showToast("تعذّر تحديد أقرب ولاية.", "error");
        }
      },
      () => {
        setLocating(false);
        showToast("تعذّر الوصول إلى موقعك. تأكد من السماح بإذن الموقع من المتصفح.", "error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  // بحث شامل عن طبيب بالاسم عبر كل الأطباء (بلا حاجة لاختيار ولاية أو تخصص أولًا).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedNameQuery(nameQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [nameQuery]);

  const { data: nameSearchResults, isFetching: searchingByName } = useQuery({
    queryKey: ["doctor-name-search", debouncedNameQuery],
    queryFn: async () =>
      (await api.get<{ data: { items: Doctor[] } }>("/doctors", { params: { q: debouncedNameQuery, pageSize: 10 } })).data.data
        .items,
    enabled: debouncedNameQuery.length >= 2,
  });

  // اختيار طبيب عبر رابط يحمل رمز QR خاص به (?doctor=ID) — يُقرأ مرة واحدة عند فتح
  // الصفحة عبر مسح رمز QR المعروض في عيادة الطبيب، فيُختار الطبيب تلقائيًا للمريض.
  const qrDoctorId = searchParams.get("doctor");
  const { data: qrDoctor } = useQuery({
    queryKey: ["qr-doctor", qrDoctorId],
    queryFn: async () => (await api.get<{ data: Doctor }>(`/doctors/${qrDoctorId}`)).data.data,
    enabled: Boolean(qrDoctorId),
    retry: false,
  });

  useEffect(() => {
    if (qrDoctor) chooseDoctorDirectly(qrDoctor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrDoctor]);

  // معاينة أقرب دور لكل طبيب مباشرة في القائمة (قبل اختياره)، حتى يقارن المريض
  // بين الأطباء المتاحين ويختار الأسرع دون أن يفتح كل طبيب على حدة. نكتفي بأول
  // 20 طبيبًا في القائمة تفاديًا لإثقال الخادم المجاني بعدد كبير من الطلبات المتوازية.
  const previewDoctors = doctors.slice(0, 20);
  const nextSlotPreviews = useQueries({
    queries: previewDoctors.map((d) => ({
      queryKey: ["next-slot-preview", d.id],
      queryFn: async () => (await api.get<{ data: NextSlot }>("/booking/next-slot", { params: { doctorId: d.id } })).data.data,
      enabled: doctorsEnabled,
      retry: false,
      staleTime: 20000,
    })),
  });

  // الدور الذي سيمنحه النظام تلقائيًا — المريض لا يختار الوقت، فقط يرى ما سيُحجز له.
  const { data: nextSlot, isFetching: loadingSlot } = useQuery({
    queryKey: ["next-slot", selectedDoctor?.id],
    queryFn: async () =>
      (await api.get<{ data: NextSlot }>("/booking/next-slot", { params: { doctorId: selectedDoctor!.id } })).data.data,
    enabled: Boolean(selectedDoctor),
    retry: false,
    // نُحدّث الدور المعروض كل نصف دقيقة تحسبًا لحجز مريض آخر قبله.
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const bookMutation = useMutation({
    // لا نرسل التاريخ ولا الوقت — الخادم هو من يعيّن الدور التالي لحظة الحجز.
    mutationFn: async (values: BookingForm) =>
      (await api.post("/booking", { ...values, doctorId: selectedDoctor!.id })).data.data,
  });

  async function onSubmit(values: BookingForm) {
    if (!selectedDoctor) {
      showToast("الرجاء اختيار طبيب.", "error");
      return;
    }
    try {
      const appointment = await bookMutation.mutateAsync(values);
      // مدة الحدث في التقويم = المدة الفعلية للموعد كما سجّلها الخادم (وليس رقمًا ثابتًا)،
      // مع رجوع احتياطي لمدة الدور المعروضة قبل التأكيد إن تعذّر حساب الفرق لأي سبب.
      const durationMinutes = diffMinutes(appointment.startTime, appointment.endTime) || nextSlot?.slotMinutes || 20;
      setConfirmed({
        date: appointment.date,
        startTime: appointment.startTime,
        doctorName: `${selectedDoctor.firstName} ${selectedDoctor.lastName}`,
        address: doctorAddress(selectedDoctor),
        patientName: `${values.firstName} ${values.lastName}`,
        clinicPhone: selectedDoctor.clinic?.phone || selectedDoctor.phone || null,
        durationMinutes,
      });
      showToast("تم إرسال طلب الحجز بنجاح!", "success");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إتمام الحجز."), "error");
    }
  }

  function closeConfirmation() {
    setConfirmed(null);
    setSelectedDoctor(null);
  }

  function closeSearch() {
    setSearchOpen(false);
    setNameQuery("");
  }

  return (
    <div className="container-app py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="w-9 shrink-0" />
          <div className="flex-1 text-center">
            <h1 className="text-2xl font-extrabold text-slate-900">احجز موعدك الآن</h1>
            <p className="mt-1 text-slate-500">
              لا حاجة لإنشاء حساب — املأ بياناتك واختر الطبيب، والموقع يمنحك أول دور متاح تلقائيًا.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="ابحث عن طبيب بالاسم مباشرة"
            aria-label="ابحث عن طبيب بالاسم مباشرة"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-primary-300 hover:text-primary-600"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="الاسم"
              error={errors.firstName?.message}
              {...register("firstName", { required: "مطلوب", minLength: { value: 2, message: "قصير جدًا" } })}
            />
            <Input
              label="اللقب"
              error={errors.lastName?.message}
              {...register("lastName", { required: "مطلوب", minLength: { value: 2, message: "قصير جدًا" } })}
            />
          </div>

          <Input
            label="رقم الهاتف (اختياري)"
            placeholder="0551234567"
            error={errors.phone?.message}
            {...register("phone", { pattern: { value: /^0[5-7][0-9]{8}$/, message: "رقم هاتف جزائري غير صالح" } })}
          />

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="label flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> الولاية
              </p>
              {availableWilayas.length > 1 && (
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={locating}
                  className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-60"
                >
                  <LocateFixed className="h-3.5 w-3.5" /> {locating ? "جارٍ تحديد موقعك..." : "استخدم موقعي"}
                </button>
              )}
            </div>
            <input type="hidden" {...register("wilayaId", { required: "الرجاء اختيار الولاية" })} />
            {loadingDoctors ? (
              <Spinner label="جارٍ تحميل الولايات المتاحة..." />
            ) : availableWilayas.length === 0 ? (
              <EmptyState title="لا يوجد أطباء مسجلون حاليًا" description="سيُفتح الحجز فور اشتراك أطباء جدد." />
            ) : availableWilayas.length === 1 ? (
              <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-sm font-semibold text-primary-700">
                <MapPin className="h-4 w-4" /> الحجز متاح حاليًا في ولاية {availableWilayas[0].nameAr} فقط
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {availableWilayas.map((w) => {
                  const active = effectiveWilayaId === w.id;
                  return (
                    <button
                      type="button"
                      key={w.id}
                      onClick={() => chooseWilaya(w.id)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${
                        active ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600 hover:border-primary-300"
                      }`}
                    >
                      <MapPin className="h-5 w-5" />
                      <span className="text-xs font-semibold leading-tight">{w.nameAr}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {errors.wilayaId && <p className="mt-1.5 text-xs text-red-500">{errors.wilayaId.message}</p>}
          </div>

          {effectiveWilayaId && (
            <div>
              <p className="label mb-2">التخصص</p>
              {/* حقل مخفي يحمل قيمة التخصص الفعلية للتحقق عبر react-hook-form؛ الاختيار يتم بصريًا بالأسفل. */}
              <input type="hidden" {...register("specialtyId", { required: "الرجاء اختيار التخصص" })} />
              {availableSpecialties.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {availableSpecialties.map((s) => {
                    const Icon = specialtyIcon(s.icon);
                    const active = specialtyId === s.id;
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => chooseSpecialty(s.id)}
                        className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${
                          active ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600 hover:border-primary-300"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="text-xs font-semibold leading-tight">{s.nameAr}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="لا يوجد أطباء في هذه الولاية حاليًا" description="جرّب ولاية أخرى." />
              )}
              {errors.specialtyId && <p className="mt-1.5 text-xs text-red-500">{errors.specialtyId.message}</p>}
            </div>
          )}

          {doctorsEnabled && (
            <div>
              <p className="label mb-2 flex items-center gap-1.5">
                <Stethoscope className="h-4 w-4" /> اختر الطبيب
              </p>
              {doctors.length > 0 ? (
                <div className="space-y-2">
                  {doctors.map((d, i) => {
                    const preview = nextSlotPreviews[i];
                    const address = doctorAddress(d);
                    return (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => setSelectedDoctor(d)}
                        className={`flex w-full items-center justify-between rounded-xl border p-3 text-right transition ${
                          selectedDoctor?.id === d.id ? "border-primary-600 bg-primary-50" : "border-slate-200 hover:border-primary-300"
                        }`}
                      >
                        <div>
                          <p className="font-semibold text-slate-800">
                            د. {d.firstName} {d.lastName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {d.city?.nameAr}
                            {d.clinic ? ` — ${d.clinic.nameAr}` : ""} · خبرة {d.yearsExperience} سنوات
                          </p>
                          {address && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                              <MapPin className="h-3 w-3 shrink-0" /> {address}
                            </p>
                          )}
                          {preview?.data && (
                            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              أقرب دور: {formatSlotLabel(preview.data.date, preview.data.startTime)}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-sm text-amber-500">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                          {d.avgRating > 0 ? d.avgRating.toFixed(1) : "جديد"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="لا يوجد أطباء متاحون" description="جرّب تخصصًا مختلفًا." />
              )}
            </div>
          )}
          {selectedDoctor && (
            <div>
              <p className="label mb-2 flex items-center gap-1.5">
                <Clock className="h-4 w-4" /> دورك الذي سيحدده الموقع
              </p>
              {loadingSlot && !nextSlot ? (
                <Spinner label="جارٍ تحديد أول دور متاح..." />
              ) : nextSlot ? (
                <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-center">
                  <p className="text-sm text-slate-600">أول دور متاح لدى هذا الطبيب</p>
                  <p className="mt-1 text-lg font-extrabold text-primary-800">
                    {new Date(nextSlot.date).toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" })}
                  </p>
                  <p className="text-2xl font-extrabold text-primary-700">{nextSlot.startTime}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    مدة الجلسة {nextSlot.slotMinutes} دقيقة — الأدوار تُمنح بالترتيب حسب أسبقية الحجز.
                  </p>
                  {doctorAddress(selectedDoctor) && (
                    <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-primary-100 pt-3 text-sm font-semibold text-slate-700">
                      <MapPin className="h-4 w-4 shrink-0 text-primary-600" /> {doctorAddress(selectedDoctor)}
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState
                  title="لا توجد أدوار متاحة"
                  description="لم يحدد هذا الطبيب أوقات عمله بعد، أو أدواره مكتملة. جرّب طبيبًا آخر."
                />
              )}
            </div>
          )}

          <Button type="submit" className="w-full" loading={bookMutation.isPending} disabled={!selectedDoctor || !nextSlot}>
            <CalendarDays className="ml-1.5 h-4 w-4" /> تأكيد الحجز وأخذ الدور
          </Button>
        </form>
      </div>

      {confirmed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={closeConfirmation}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
            <h2 className="text-lg font-extrabold text-slate-900">تم حجز موعدك بنجاح ✅</h2>
            <div className="mt-3 space-y-1">
              <p className="font-semibold text-slate-700">الدكتور: {confirmed.doctorName}</p>
              <p className="text-slate-600">
                التاريخ: {new Date(confirmed.date).toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <p className="text-slate-600">الساعة: {confirmed.startTime}</p>
            </div>
            {confirmed.address && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-slate-500">
                <MapPin className="h-3.5 w-3.5 shrink-0" /> {confirmed.address}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500">أضف الموعد إلى تقويم هاتفك حتى لا تنساه</p>
              <button
                type="button"
                onClick={() => {
                  const { icsUrl } = buildCalendarLinks({
                    doctorName: confirmed.doctorName,
                    patientName: confirmed.patientName,
                    clinicPhone: confirmed.clinicPhone,
                    address: confirmed.address,
                    dateStr: confirmed.date,
                    startTime: confirmed.startTime,
                    durationMinutes: confirmed.durationMinutes,
                  });
                  const link = document.createElement("a");
                  link.href = icsUrl;
                  link.download = "medbook-appointment.ics";
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                  showToast("تمت إضافة الموعد إلى تقويم هاتفك بنجاح ✅", "success");
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
              >
                <CalendarDays className="h-4 w-4" /> إضافة إلى التقويم
              </button>
              {(() => {
                const { googleUrl } = buildCalendarLinks({
                  doctorName: confirmed.doctorName,
                  patientName: confirmed.patientName,
                  clinicPhone: confirmed.clinicPhone,
                  address: confirmed.address,
                  dateStr: confirmed.date,
                  startTime: confirmed.startTime,
                  durationMinutes: confirmed.durationMinutes,
                });
                return (
                  <a
                    href={googleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-primary-600 hover:text-primary-700"
                  >
                    أو أضِفه إلى Google Calendar
                  </a>
                );
              })()}
            </div>

            <Button variant="outline" className="mt-4 w-full" onClick={closeConfirmation}>
              لاحقًا
            </Button>
          </div>
        </div>
      )}

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-16"
          onClick={closeSearch}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 font-bold text-slate-800">
                <Search className="h-4 w-4" /> ابحث عن طبيب بالاسم مباشرة
              </p>
              <button type="button" onClick={closeSearch} className="text-slate-400 hover:text-slate-600" aria-label="إغلاق">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Input
              placeholder="اكتب اسم الطبيب..."
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              autoFocus
            />
            {searchingByName && <Spinner label="جارٍ البحث..." />}
            {debouncedNameQuery.length >= 2 && !searchingByName && (
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {nameSearchResults && nameSearchResults.length > 0 ? (
                  nameSearchResults.map((d) => (
                    <button
                      type="button"
                      key={d.id}
                      onClick={() => {
                        chooseDoctorDirectly(d);
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-right transition hover:border-primary-300"
                    >
                      <div>
                        <p className="font-semibold text-slate-800">
                          د. {d.firstName} {d.lastName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {d.specialty.nameAr} · {d.wilaya.nameAr}
                          {d.city ? ` — ${d.city.nameAr}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-sm text-amber-500">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        {d.avgRating > 0 ? d.avgRating.toFixed(1) : "جديد"}
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyState title="لا نتائج" description="جرّب اسمًا آخر." />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
