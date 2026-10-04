import { useId, useRef, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, UserPlus } from "lucide-react";
import { apiErrorMessage, classifyApiError } from "../lib/api";
import { useToast } from "./ui/Toast";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { useRegisterWalkIn, useTodaySlots, type WalkInResult } from "../hooks/useWalkIn";
import { buildWalkInBody, EMPTY_WALK_IN, keepKeyAfterError, newIdempotencyKey, resolveWalkInDoctor, validateWalkIn, type WalkInErrors, type WalkInForm } from "../lib/walkIn";

/** العبارة التي يضيفها الخادم لكل تسجيل من الاستقبال (تُستعمل أيضًا لتمييز «حضر بدون موعد» في الطابور). */
export const WALK_IN_NOTE = "سُجّل بواسطة المساعد";

export type WalkInDoctor = { id: string; firstName: string; lastName: string };
const doctorLabel = (d: WalkInDoctor) => `د. ${d.firstName} ${d.lastName}`;
/** تاريخ اليوم بتوقيت الجزائر (UTC+1)، كما في لوحة الاستقبال. */
const algeriaToday = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);

/**
 * «تسجيل مريض حضر» داخل لوحة الاستقبال الموحّدة:
 *  - الطبيب من الأطباء المرتبطين بالمساعد فقط؛ تلقائي إن كان طبيبًا واحدًا. يُرسل في ترويسة هذا الطلب وحده.
 *  - تغيير الطبيب: تُحمَّل أوقاته، ويُمسح الوقت المختار، ومفتاح منع تكرار جديد.
 *  - أقرب وقت متاح تلقائيًا أو وقت محدد من أوقات اليوم؛ زر معطّل ومفتاح ثابت للمحاولة الواحدة ضد الضغط المزدوج.
 */
export function WalkInPanel({ doctors }: { doctors: WalkInDoctor[] }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const formId = useId();
  const today = algeriaToday();
  const [chosenDoctor, setChosenDoctor] = useState("");
  const doctorId = resolveWalkInDoctor(doctors.map((d) => d.id), chosenDoctor);
  const doctor = doctors.find((d) => d.id === doctorId) ?? null;
  const slots = useTodaySlots(doctorId, today);
  const register = useRegisterWalkIn();

  const [form, setForm] = useState<WalkInForm>(EMPTY_WALK_IN);
  const [timeMode, setTimeMode] = useState<"auto" | "choose">("auto");
  const [errors, setErrors] = useState<WalkInErrors & { doctor?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<(WalkInResult & { doctorName: string }) | null>(null);
  const keyRef = useRef<string>(newIdempotencyKey());
  // حارس متزامن: نقرتان في نفس اللحظة قبل إعادة الرسم لا تُرسلان طلبين.
  const inFlight = useRef(false);
  const firstNameRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof WalkInForm>(k: K, v: WalkInForm[K]) => {
    const next = { ...form, [k]: v };
    setForm(next);
    setErrors(e => e[k] ? { ...e, [k]: validateWalkIn(next)[k] } : e);
  };

  function changeDoctor(id: string) {
    if (id === chosenDoctor) return;
    setChosenDoctor(id);
    // أوقات طبيب آخر: لا نحتفظ بوقت مختار ولا بمفتاح محاولة سابقة.
    setForm((f) => ({ ...f, startTime: "" }));
    keyRef.current = newIdempotencyKey();
    setErrors((e) => ({ ...e, doctor: undefined, startTime: undefined }));
    setSubmitError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || register.isPending) return;
    const effective: WalkInForm = { ...form, startTime: timeMode === "choose" ? form.startTime : "" };
    const errs: WalkInErrors & { doctor?: string } = validateWalkIn(effective);
    if (!doctorId) errs.doctor = "اختر الطبيب.";
    if (timeMode === "choose" && !effective.startTime) errs.startTime = "اختر وقتًا من القائمة، أو اختر «أقرب وقت متاح».";
    setErrors(errs);
    setSubmitError(null);
    if (Object.keys(errs).length || !doctor) {
      window.setTimeout(() => document.getElementById(`${formId}-title`)?.closest('section')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }

    inFlight.current = true;
    try {
      const res = await register.mutateAsync({ doctorId: doctor.id, body: buildWalkInBody(effective, keyRef.current) });
      const name = doctorLabel(doctor);
      setLastDone({ ...res, doctorName: name });
      showToast(`سُجّل ${res.guestFirstName} ${res.guestLastName} عند ${name} على الساعة ${res.startTime}.`, "success");
      setForm(EMPTY_WALK_IN);
      setTimeMode("auto");
      keyRef.current = newIdempotencyKey();
      setTimeout(() => firstNameRef.current?.focus(), 0);
    } catch (err) {
      const { status } = classifyApiError(err);
      const code = (err as any)?.response?.data?.details?.code as string | undefined;
      setSubmitError(apiErrorMessage(err, "تعذّر تسجيل المريض."));
      if (code === "SLOT_TAKEN") {
        // الوقت أخذه غيرنا: نحدّث الأوقات ونطلب اختيارًا جديدًا (لا ننقله بصمت).
        set("startTime", "");
        void slots.refetch();
      }
      if (!keepKeyAfterError(status)) keyRef.current = newIdempotencyKey();
    } finally {
      inFlight.current = false;
    }
  }

  const slotList = slots.data?.slots ?? [];
  const inputCls = (bad?: string) =>
    clsx("mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary-100", bad ? "border-red-400 focus:border-red-500" : "border-slate-200 focus:border-primary-400");

  if (!doctors.length) return null;

  return (
    <>
    <Button className="min-h-11" onClick={() => setOpen(true)}><UserPlus aria-hidden="true" className="h-5 w-5" />إضافة مريض</Button>
    {lastDone && !open && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">سُجّل {lastDone.guestFirstName} {lastDone.guestLastName} عند {lastDone.doctorName} — <bdi dir="ltr">{lastDone.startTime}</bdi></p>}
    <Modal open={open} onClose={() => { if (!inFlight.current) setOpen(false); }} title="تسجيل مريض حضر">
    <section aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <UserPlus className="h-5 w-5 text-primary-600" aria-hidden="true" /> تسجيل مريض حضر
      </h2>
      <p className="mt-1 text-sm text-slate-600">يُسجَّل كضيف بالاسم والهاتف لليوم، ويدخل طابور الطبيب مباشرة. الحقول المعلّمة بـ «مطلوب» إلزامية.</p>

      {lastDone && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            سُجّل <strong>{lastDone.guestFirstName} {lastDone.guestLastName}</strong> عند <strong>{lastDone.doctorName}</strong> — موعده{" "}
            <strong className="tabular-nums" dir="ltr">{lastDone.startTime}</strong>
            {lastDone.replayed ? " (كان مسجّلًا من قبل بنفس الطلب)." : "."}
          </span>
        </p>
      )}

      <form className="mt-4 space-y-4" onSubmit={submit} noValidate aria-busy={register.isPending || undefined}>
        <fieldset disabled={register.isPending} className="space-y-4">
        {doctors.length > 1 ? (
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              الطبيب (مطلوب)
              <select className={inputCls(errors.doctor)} value={doctorId} onChange={(e) => changeDoctor(e.target.value)} aria-invalid={Boolean(errors.doctor)} aria-describedby={errors.doctor ? `${formId}-dr` : undefined}>
                <option value="">اختر الطبيب</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{doctorLabel(d)}</option>)}
              </select>
            </label>
            {errors.doctor && <span id={`${formId}-dr`} className="mt-1 block text-xs text-red-700">{errors.doctor}</span>}
          </div>
        ) : (
          <p className="text-sm text-slate-600">الطبيب: <strong>{doctor && doctorLabel(doctor)}</strong></p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              الاسم (مطلوب)
              <input ref={firstNameRef} className={inputCls(errors.firstName)} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.firstName)} aria-describedby={errors.firstName ? `${formId}-fn` : undefined} />
            </label>
            {errors.firstName && <span id={`${formId}-fn`} className="mt-1 block text-xs text-red-700">{errors.firstName}</span>}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              اللقب (مطلوب)
              <input className={inputCls(errors.lastName)} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.lastName)} aria-describedby={errors.lastName ? `${formId}-ln` : undefined} />
            </label>
            {errors.lastName && <span id={`${formId}-ln`} className="mt-1 block text-xs text-red-700">{errors.lastName}</span>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700">
            رقم الهاتف (مطلوب)
            <input dir="ltr" inputMode="tel" placeholder="0551234567" className={clsx(inputCls(errors.phone), "text-left tabular-nums")} value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? `${formId}-ph` : undefined} />
          </label>
          {errors.phone && <span id={`${formId}-ph`} className="mt-1 block text-xs text-red-700">{errors.phone}</span>}
        </div>

        <fieldset disabled={!doctorId}>
          <legend className="text-sm font-semibold text-slate-700">الوقت (تلقائي أو اختيار محدد)</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={clsx("flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm", timeMode === "auto" ? "border-primary-400 bg-primary-50" : "border-slate-200")}>
              <input type="radio" name={`${formId}-mode`} className="mt-1" checked={timeMode === "auto"} onChange={() => setTimeMode("auto")} />
              <span>
                <span className="block font-semibold">أقرب وقت متاح</span>
                <span className="text-xs text-slate-600">
                  {!doctorId ? "اختر الطبيب أولًا" : slots.isPending ? "جارٍ تحميل الأوقات…" : slotList.length ? <>الآن: <span className="tabular-nums" dir="ltr">{slotList[0]}</span></> : "لا أوقات متاحة متبقية اليوم"}
                </span>
              </span>
            </label>
            <label className={clsx("flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm", timeMode === "choose" ? "border-primary-400 bg-primary-50" : "border-slate-200")}>
              <input type="radio" name={`${formId}-mode`} className="mt-1" checked={timeMode === "choose"} onChange={() => setTimeMode("choose")} />
              <span>
                <span className="block font-semibold">اختيار وقت</span>
                <span className="text-xs text-slate-600">من الأوقات المتاحة اليوم</span>
              </span>
            </label>
          </div>
          {timeMode === "choose" && (
            <div className="mt-3">
              <label className="block text-sm font-semibold text-slate-700">
                الوقت المتاح
                <select dir="ltr" className={clsx(inputCls(errors.startTime), "tabular-nums")} value={form.startTime} onChange={(e) => set("startTime", e.target.value)} disabled={slots.isPending || slotList.length === 0} aria-invalid={Boolean(errors.startTime)} aria-describedby={errors.startTime ? `${formId}-st` : undefined}>
                  <option value="">{slots.isPending ? "جارٍ التحميل…" : slotList.length ? "اختر وقتًا" : "لا أوقات متاحة اليوم"}</option>
                  {slotList.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {slots.isError && <span className="mt-1 block text-xs text-red-700">تعذّر تحميل الأوقات. <button type="button" className="underline" onClick={() => void slots.refetch()}>إعادة المحاولة</button></span>}
              {errors.startTime && <span id={`${formId}-st`} className="mt-1 block text-xs text-red-700">{errors.startTime}</span>}
            </div>
          )}
        </fieldset>

        <div>
          <label className="block text-sm font-semibold text-slate-700">
            ملاحظات <span className="font-normal text-slate-600">(اختياري)</span>
            <textarea rows={2} className={inputCls(errors.notes)} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} aria-invalid={Boolean(errors.notes)} aria-describedby={`${formId}-nt`} />
          </label>
          <span id={`${formId}-nt`} className="mt-1 block text-xs font-normal text-slate-600">{errors.notes || `تُضاف تلقائيًا عبارة «${WALK_IN_NOTE}».`}</span>
        </div>

        {submitError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{submitError}</p>}

        <Button type="submit" className="w-full sm:w-auto" loading={register.isPending} disabled={register.isPending}>
          تسجيل الحضور
        </Button>
        </fieldset>
      </form>
    </section>
    </Modal>
    </>
  );
}
