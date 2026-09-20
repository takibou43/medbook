import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { useToast } from "../components/ui/Toast";
import { Spinner } from "../components/ui/States";
import { Doctor, NextSlot, Paginated } from "../types";
import { bookingError, diffMinutes, doctorAddress, splitFullName } from "../lib/booking";
import { BookingSteps, StepId } from "../components/booking/BookingSteps";
import { SpecialtyOption, SpecialtyStep } from "../components/booking/SpecialtyStep";
import { DoctorStep } from "../components/booking/DoctorStep";
import { SlotStep } from "../components/booking/SlotStep";
import { PatientForm, PatientStep } from "../components/booking/PatientStep";
import { ConfirmStep } from "../components/booking/ConfirmStep";
import { ConfirmedBooking, SuccessModal } from "../components/booking/SuccessModal";
import { DoctorSearchModal } from "../components/booking/DoctorSearchModal";
import { InlineError } from "../components/booking/StepParts";

// نجلب الأطباء الموثّقين (المفعّلين) مرة واحدة ونشتق منهم محليًا التخصصات وعدد أطباء كل تخصص وقوائم الأطباء —
// فلا نطلب من الخادم شيئًا عند كل نقرة، ولا يظهر للمريض تخصص أو طبيب غير حقيقي. الخادم يحدّ الصفحة بـ 50
// طبيبًا، لذا نجلب بقية الصفحات (إن وُجدت) بالتوازي حتى تكون الأعداد دقيقة عند نمو عدد الأطباء.
async function fetchAllDoctors(): Promise<Doctor[]> {
  const get = async (page: number) =>
    (await api.get<{ data: Paginated<Doctor> }>("/doctors", { params: { pageSize: 50, page } })).data.data;
  const first = await get(1);
  const extraPages = Math.min(first.totalPages, 10);
  if (extraPages <= 1) return first.items;
  const rest = await Promise.all(Array.from({ length: extraPages - 1 }, (_, i) => get(i + 2)));
  return [...first.items, ...rest.flatMap((r) => r.items)];
}

export default function BookAppointment() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // الاختيارات محفوظة في هذا المكوّن أثناء التنقل بين الخطوات، فلا تضيع عند الرجوع.
  const [step, setStep] = useState<StepId>("specialty");
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedBooking | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // بيانات المريض (الاسم واللقب + الهاتف) — تُحفظ عند التنقل بين الخطوات وتُفرَّغ بعد نجاح الحجز.
  const form = useForm<PatientForm>({ defaultValues: { fullName: "", phone: "" } });

  const {
    data: allDoctors,
    isLoading: loadingDoctors,
    isError: doctorsFailed,
    error: doctorsError,
    refetch: refetchDoctors,
  } = useQuery({ queryKey: ["book-doctors-all"], queryFn: fetchAllDoctors, staleTime: 60000 });

  const specialtyOptions = useMemo<SpecialtyOption[]>(() => {
    const map = new Map<string, SpecialtyOption>();
    for (const d of allDoctors ?? []) {
      const existing = map.get(d.specialtyId);
      if (existing) existing.doctorsCount += 1;
      else map.set(d.specialtyId, { specialty: d.specialty, doctorsCount: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.doctorsCount - a.doctorsCount || a.specialty.nameAr.localeCompare(b.specialty.nameAr, "ar"));
  }, [allDoctors]);

  const specialtyDoctors = useMemo(() => (allDoctors ?? []).filter((d) => d.specialtyId === specialtyId), [allDoctors, specialtyId]);
  const selectedSpecialty = specialtyOptions.find((o) => o.specialty.id === specialtyId)?.specialty ?? selectedDoctor?.specialty ?? null;

  // اختيار طبيب مباشرة (من البحث بالاسم أو من رابط QR الخاص بالطبيب) — يتجاوز خطوتي التخصص والطبيب
  // ويضبط التخصص ليبقى الرجوع إلى قائمة أطباء نفس التخصص ممكنًا.
  function chooseDoctorDirectly(d: Doctor) {
    setSpecialtyId(d.specialtyId);
    setSelectedDoctor(d);
    setSubmitError(null);
    setStep("slot");
  }

  // رابط الحجز المباشر (?doctor=ID) — يُقرأ عند فتح الصفحة عبر مسح رمز QR الموجود في العيادة.
  const qrDoctorId = searchParams.get("doctor");
  const qrApplied = useRef(false);
  const {
    data: qrDoctor,
    isLoading: loadingQr,
    isError: qrFailed,
  } = useQuery({
    queryKey: ["qr-doctor", qrDoctorId],
    queryFn: async () => (await api.get<{ data: Doctor }>(`/doctors/${qrDoctorId}`)).data.data,
    enabled: Boolean(qrDoctorId),
    retry: false,
  });

  useEffect(() => {
    if (qrDoctor && !qrApplied.current) {
      qrApplied.current = true;
      chooseDoctorDirectly(qrDoctor);
    }
  }, [qrDoctor]);

  // الدور الذي سيمنحه النظام تلقائيًا للطبيب المختار. يُحدَّث كل نصف دقيقة أثناء عرضه فقط
  // تحسبًا لحجز مريض آخر قبله؛ الخادم هو المرجع النهائي لحظة الحجز.
  const slotEnabled = Boolean(selectedDoctor) && step !== "specialty" && step !== "doctor";
  const {
    data: nextSlot,
    isFetching: loadingSlot,
    error: slotError,
    refetch: refetchSlot,
  } = useQuery({
    queryKey: ["next-slot", selectedDoctor?.id],
    queryFn: async () => (await api.get<{ data: NextSlot }>("/booking/next-slot", { params: { doctorId: selectedDoctor!.id } })).data.data,
    enabled: slotEnabled,
    retry: false,
    refetchInterval: step === "slot" ? 30000 : false,
    refetchIntervalInBackground: false,
  });
  const slotErr = slotError ? bookingError(slotError, "تعذّر تحميل الموعد.") : null;

  const bookMutation = useMutation({
    // لا نرسل التاريخ ولا الوقت — الخادم هو من يعيّن الدور التالي لحظة الحجز ويمنع التكرار.
    mutationFn: async (payload: { firstName: string; lastName: string; phone: string; doctor: Doctor }) =>
      (
        await api.post("/booking", {
          firstName: payload.firstName,
          lastName: payload.lastName,
          phone: payload.phone,
          wilayaId: payload.doctor.wilaya.id,
          specialtyId: payload.doctor.specialtyId,
          doctorId: payload.doctor.id,
        })
      ).data.data,
  });

  async function confirmBooking() {
    if (!selectedDoctor) return;
    const values = form.getValues();
    const name = splitFullName(values.fullName);
    if (!name) {
      setStep("patient");
      return;
    }
    setSubmitError(null);
    try {
      const appointment = await bookMutation.mutateAsync({ ...name, phone: values.phone.trim(), doctor: selectedDoctor });
      // مدة الحدث في التقويم = المدة الفعلية للموعد كما سجّلها الخادم (وليس رقمًا ثابتًا)،
      // مع رجوع احتياطي لمدة الدور المعروضة قبل التأكيد إن تعذّر حساب الفرق لأي سبب.
      const durationMinutes = diffMinutes(appointment.startTime, appointment.endTime) || nextSlot?.slotMinutes || 20;
      setConfirmed({
        date: appointment.date,
        startTime: appointment.startTime,
        doctorName: `${selectedDoctor.firstName} ${selectedDoctor.lastName}`,
        address: doctorAddress(selectedDoctor),
        patientName: `${name.firstName} ${name.lastName}`,
        clinicPhone: selectedDoctor.clinic?.phone || selectedDoctor.phone || null,
        durationMinutes,
      });
      showToast("تم إرسال طلب الحجز بنجاح!", "success");
      // نفرّغ بيانات المريض فور نجاح الحجز حتى لا يُكرَّر الحجز بالخطأ بضغطة ثانية.
      form.reset({ fullName: "", phone: "" });
      queryClient.invalidateQueries({ queryKey: ["next-slot"] });
      queryClient.invalidateQueries({ queryKey: ["next-slot-preview"] });
    } catch (err) {
      const { kind, message } = bookingError(err, "تعذّر إتمام الحجز.");
      if (kind === "conflict") {
        // الدور أُخذ أو انتهت الأدوار: نحدّث الدور المعروض ونعيد المريض لخطوة الموعد برسالة واضحة.
        showToast(message, "error");
        queryClient.invalidateQueries({ queryKey: ["next-slot", selectedDoctor.id] });
        queryClient.invalidateQueries({ queryKey: ["next-slot-preview", selectedDoctor.id] });
        setStep("slot");
      } else if (kind === "notFound") {
        // الطبيب لم يعد متاحًا (أُوقف/انتهى اشتراكه): نحدّث القائمة ونعيده لاختيار طبيب آخر.
        showToast(message, "error");
        queryClient.invalidateQueries({ queryKey: ["book-doctors-all"] });
        setSelectedDoctor(null);
        setStep(specialtyId ? "doctor" : "specialty");
      } else {
        setSubmitError(message);
      }
    }
  }

  function closeConfirmation() {
    setConfirmed(null);
    setSelectedDoctor(null);
    setSubmitError(null);
    setStep(specialtyId ? "doctor" : "specialty");
  }

  // ===== التنقل بين الخطوات + التمرير التلقائي السلس =====
  // عند كل انتقال نمرّر إلى عنوان الخطوة الجديدة (بحركة سلسة إلا لمن فعّل "تقليل الحركة")
  // ونقل التركيز إليه ليعلنه قارئ الشاشة — فلا يبحث المريض عن مكان الحقل التالي على الهاتف.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const el = headingRef.current;
    if (!el) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, [step]);

  const openingDirectLink = Boolean(qrDoctorId) && loadingQr && !qrApplied.current;

  return (
    <div className="container-app py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold text-slate-900">احجز موعدك بسهولة</h1>
          <p className="mt-1 text-slate-600">لا حاجة لإنشاء حساب — اختر التخصص ثم الطبيب، والموقع يمنحك أول دور متاح.</p>
        </div>

        <BookingSteps current={step} />

        {qrDoctorId && qrFailed && !selectedDoctor && (
          <div className="mb-4">
            <InlineError title="تعذّر فتح صفحة هذا الطبيب." message="يمكنك اختيار التخصص والطبيب من القائمة." />
          </div>
        )}

        {openingDirectLink ? (
          <Spinner label="جارٍ فتح صفحة الطبيب..." />
        ) : (
          <>
            {step === "specialty" && (
              <SpecialtyStep
                ref={headingRef}
                options={specialtyOptions}
                loading={loadingDoctors}
                error={doctorsFailed}
                errorMessage={doctorsFailed ? apiErrorMessage(doctorsError) : undefined}
                onRetry={() => refetchDoctors()}
                onSelect={(id) => {
                  // نفس التخصص → نُبقي الطبيب المختار سابقًا؛ تخصص جديد → نبدأ اختيار طبيب من جديد.
                  if (id !== specialtyId) setSelectedDoctor(null);
                  setSpecialtyId(id);
                  setStep("doctor");
                }}
                onOpenSearch={() => setSearchOpen(true)}
              />
            )}

            {step === "doctor" && (
              <DoctorStep
                ref={headingRef}
                specialty={selectedSpecialty}
                doctors={specialtyDoctors}
                loading={loadingDoctors}
                error={doctorsFailed}
                errorMessage={doctorsFailed ? apiErrorMessage(doctorsError) : undefined}
                onRetry={() => refetchDoctors()}
                onSelect={(d) => {
                  setSelectedDoctor(d);
                  setStep("slot");
                }}
                onBack={() => setStep("specialty")}
              />
            )}

            {step === "slot" && selectedDoctor && (
              <SlotStep
                ref={headingRef}
                doctor={selectedDoctor}
                slot={nextSlot}
                loading={loadingSlot}
                errorKind={slotErr ? (slotErr.kind === "conflict" ? "noSlots" : "failed") : "none"}
                errorMessage={slotErr?.message}
                onRetry={() => refetchSlot()}
                onContinue={() => setStep("patient")}
                onBack={() => setStep("doctor")}
                backLabel="العودة إلى الأطباء"
              />
            )}

            {step === "patient" && selectedDoctor && (
              <PatientStep ref={headingRef} form={form} onSubmit={() => setStep("confirm")} onBack={() => setStep("slot")} />
            )}

            {step === "confirm" && selectedDoctor && nextSlot && (
              <ConfirmStep
                ref={headingRef}
                doctor={selectedDoctor}
                slot={nextSlot}
                patientName={form.getValues("fullName").trim().replace(/\s+/g, " ")}
                patientPhone={form.getValues("phone").trim()}
                submitting={bookMutation.isPending}
                errorMessage={submitError}
                onConfirm={confirmBooking}
                onBack={() => setStep("patient")}
              />
            )}
          </>
        )}
      </div>

      {confirmed && <SuccessModal booking={confirmed} onClose={closeConfirmation} />}

      {searchOpen && (
        <DoctorSearchModal
          onClose={() => setSearchOpen(false)}
          onSelect={(d) => {
            setSearchOpen(false);
            chooseDoctorDirectly(d);
          }}
        />
      )}
    </div>
  );
}
