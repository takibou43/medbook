import { useAttendanceActions } from "../../hooks/useAttendanceActions";
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, CheckCircle2, Clock3, Megaphone, PhoneCall, UserCheck, UserX, Users, X } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner, EmptyState } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { disablePush, enablePush, isPushSubscribed, pushSupported } from "../../lib/push";
import { ASSISTANT_QUEUE_POLL_MS, QUEUE_POLL_MS, useCallNext, useCallPatient, useFinishAppointment, useMarkArrived, useMarkLate, useQueue } from "../../hooks/useQueue";
import { useAuth } from "../../context/AuthContext";
import { NoShowSmsDialog, NoShowTarget } from "../../components/NoShowSmsDialog";
import { Appointment } from "../../types";
import { RELATIONSHIP_LABELS } from "../../lib/features";

// المريض قد يكون صاحب حساب أو ضيفًا حجز باسمه فقط — نعرض الاسم المتوفر أيًّا كان مصدره.
function patientName(a: Appointment): string {
  // موعد لفرد من عائلة صاحب الحساب: المستفيد هو من يدخل على الطبيب (مع صلة القرابة).
  if (a.familyMember) return `${a.familyMember.firstName} ${a.familyMember.lastName} (${RELATIONSHIP_LABELS[a.familyMember.relationship]})`;
  if (a.patient) return a.patient.firstName + " " + a.patient.lastName;
  const guest = [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ").trim();
  return guest || "مريض بدون اسم";
}

function patientPhone(a: Appointment): string | null {
  return a.patient?.user?.phone ?? a.guestPhone ?? null;
}

// "مريض واحد" / "مريضان" / "3 مرضى" / "11 مريضًا" — عدد المرضى الذين يمرّون قبل المتأخر.
function patientsCount(n: number): string {
  if (n === 1) return "مريض واحد";
  if (n === 2) return "مريضين";
  if (n >= 3 && n <= 10) return `${n} مرضى`;
  return `${n} مريضًا`;
}

// رسالة ما بعد «متأخر» من رد الخادم نفسه: كم مركزًا تراجع فعلًا (2 أول مرة، ثم 4)، أو أن الضغطة تكرار.
function lateToast(res: unknown): string {
  const r = res as { duplicate?: boolean; lateEvent?: { penalty: number; sequence: number } | null } | undefined;
  if (r?.duplicate) return "مسجَّل متأخرًا مسبقًا — لم يُحتسب تأخير إضافي.";
  const penalty = r?.lateEvent?.penalty ?? 2;
  const seq = r?.lateEvent?.sequence;
  return `لم يُسجَّل غيابًا — بقي في الطابور ويعود دوره بعد ${patientsCount(penalty)}${seq && seq > 1 ? ` (التأخير رقم ${seq})` : ""}.`;
}

// تنبيه صوتي قصير (نغمتان) بلا ملفات صوت — قد يمنعه المتصفح قبل أول لمسة للصفحة، فنتجاهل الفشل بصمت.
function playCallChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.25;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 1000);
  } catch {
    /* لا صوت — لا مشكلة */
  }
  try {
    navigator.vibrate?.([150, 80, 150]);
  } catch {
    /* بعض المتصفحات لا تدعم الاهتزاز */
  }
}

// مدة بقاء شريط «الطبيب نادى على...» عند المساعد قبل اختفائه تلقائيًا.
const CALL_BANNER_MS = 20000;
// أي تغيّر للمريض الحالي خلال هذه المدة بعد ضغطة من هذا الجهاز نفسه لا يُعدّ «نداءً من الطبيب».
const SELF_ACTION_GRACE_MS = 8000;

export default function DoctorQueue() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const isAssistant = user?.role === "ASSISTANT";
  const canManageAttendance = useAttendanceActions();
  const { data, isLoading, isFetching } = useQueue(isAssistant ? ASSISTANT_QUEUE_POLL_MS : QUEUE_POLL_MS);

  // شريط «الطبيب نادى على: فلان» الذي يظهر عند المساعد تلقائيًا.
  const [callBanner, setCallBanner] = useState<{ id: string; name: string; time: string } | null>(null);
  const prevCurrentId = useRef<string | null | undefined>(undefined);
  const lastSelfActionAt = useRef(0);
  const markSelfAction = () => {
    lastSelfActionAt.current = Date.now();
  };

  const callNext = useCallNext();
  const callPatient = useCallPatient();
  const markLate = useMarkLate();
  const markArrived = useMarkArrived();
  const finish = useFinishAppointment();

  const busy =
    callNext.isPending ||
    callPatient.isPending ||
    markLate.isPending ||
    markArrived.isPending ||
    finish.isPending;

  // حالة إشعارات هذا الجهاز تحديدًا (وليس الحساب): قد يفعّلها على هاتفه دون حاسوب العيادة.
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  // الموعد المعروض في نافذة «لم يحضر» + إشعار SMS من شريحة الطبيب.
  const [noShowTarget, setNoShowTarget] = useState<NoShowTarget | null>(null);

  function openNoShow(a: Appointment) {
    setNoShowTarget({
      id: a.id,
      patientName: patientName(a),
      phone: patientPhone(a),
      date: a.date,
      startTime: a.startTime,
      alreadyNoShow: a.status === "NO_SHOW",
    });
  }

  /**
   * المريض نودي عليه فلم يحضر: لا نسجّله غائبًا نهائيًا هنا إطلاقًا. ننقله إلى قائمة
   * المتأخرين (يعود دوره تلقائيًا بعد مريضين، بلا حد للتأجيل) ثم تفتح النافذة تطبيق
   * الرسائل من هاتف المساعد. الغياب النهائي (NO_SHOW) يُعتمد وحده عند انتهاء دوام
   * الطبيب عبر autoExpireStaleAppointments في الخادم — وهي القاعدة الموجودة أصلًا.
   */
  async function deferAndNotify(id: string) {
    markSelfAction();
    try {
      const res = await markLate.mutateAsync(id);
      showToast(lateToast(res), "success");
      return res;
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر نقله إلى قائمة المتأخرين."), "error");
      throw err;
    }
  }

  // المريض الحالي تغيّر دون أن يضغط هذا الجهاز شيئًا ⇒ الطبيب نادى عليه: نعرض اسمه للمساعد فورًا.
  const currentId = data ? data.current?.id ?? null : undefined;
  useEffect(() => {
    if (currentId === undefined) return; // لم تصل البيانات بعد
    const prev = prevCurrentId.current;
    prevCurrentId.current = currentId;
    if (prev === undefined) return; // أول تحميل للصفحة: لا تنبيه
    if (!currentId) {
      setCallBanner(null);
      return;
    }
    if (currentId === prev) return;
    if (!isAssistant || Date.now() - lastSelfActionAt.current < SELF_ACTION_GRACE_MS) return;
    const c = data?.current;
    if (!c) return;
    setCallBanner({ id: c.id, name: patientName(c), time: c.startTime });
    playCallChime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, isAssistant]);

  useEffect(() => {
    if (!callBanner) return;
    const t = setTimeout(() => setCallBanner(null), CALL_BANNER_MS);
    return () => clearTimeout(t);
  }, [callBanner]);

  useEffect(() => {
    isPushSubscribed().then(setPushOn).catch(() => setPushOn(false));
  }, []);

  async function togglePush() {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        showToast("تم إيقاف الإشعارات على هذا الجهاز.", "success");
      } else {
        const result = await enablePush();
        if (result.ok) {
          setPushOn(true);
          showToast("تم تفعيل الإشعارات على هذا الجهاز ✅", "success");
        } else {
          showToast(result.reason ?? "تعذّر تفعيل الإشعارات.", "error");
        }
      }
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر تغيير حالة الإشعارات."), "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function run(action: Promise<unknown>, successMessage: string, fallbackError: string) {
    markSelfAction();
    try {
      await action;
      showToast(successMessage, "success");
    } catch (err) {
      showToast(apiErrorMessage(err, fallbackError), "error");
    }
  }

  if (isLoading && !data) return <Spinner label="جارٍ تحميل طابور اليوم..." />;

  const current = data?.current ?? null;
  const waiting = data?.waiting ?? [];
  const late = data?.late ?? [];
  // متوسط مدة الجلسة — يُعرض فقط إن كان محسوبًا من جلسات حقيقية (لا القيمة الافتراضية)، وبتسميته الدقيقة.
  const avgSessionMinutes =
    data && data.estimatedDurationIsFallback === false ? data.estimatedDurationMinutes : null;
  const summary = data?.todaySummary;
  // الطابور الموحّد بترتيب المناداة الفعلي من الخادم (المتأخر يظهر في مركزه الجديد مع شارة «متأخر»).
  // مع خادم قديم بلا هذا الحقل نعود للعرض السابق: المنتظرون ثم قائمة المتأخرين منفصلة.
  const ordered = data?.ordered;
  const queueList: Appointment[] = ordered ?? waiting;

  return (
    <div className="space-y-5">
      <NoShowSmsDialog target={noShowTarget} mode="call" onConfirm={deferAndNotify} onClose={() => setNoShowTarget(null)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">طابور اليوم</h1>
          <p className="text-sm text-slate-600" aria-live="polite">
            {waiting.length} في الانتظار · {late.length} متأخرون
            {summary ? ` · ${summary.completed} مكتملة من ${summary.total}` : ""}
            {isFetching ? " · جارٍ التحديث..." : ""}
          </p>
          {avgSessionMinutes !== null && (
            <p className="mt-0.5 text-xs text-slate-600">
              متوسط مدة الجلسة: ~{avgSessionMinutes} دقيقة (من آخر {data?.estimatedDurationSamples ?? ""} جلسات مكتملة)
            </p>
          )}
        </div>

        {pushSupported() && (
          <button
            type="button"
            onClick={togglePush}
            disabled={pushBusy}
            className={
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 " +
              (pushOn
                ? "border-primary-200 bg-primary-50 text-primary-700"
                : "border-slate-200 text-slate-600 hover:border-primary-300")
            }
          >
            {pushOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            {pushOn ? "الإشعارات مفعّلة" : "تفعيل الإشعارات"}
          </button>
        )}
      </div>

      {/* عند المساعد: الطبيب نادى على مريض — اسمه يظهر تلقائيًا */}
      {isAssistant && callBanner && current?.id === callBanner.id && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm animate-pulse"
        >
          <Megaphone className="h-7 w-7 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-amber-700">الطبيب نادى الآن على</p>
            <p className="truncate text-xl font-extrabold text-slate-900">{callBanner.name}</p>
            <p className="text-xs text-slate-600">موعده {callBanner.time} · إن لم يكن موجودًا اضغط «متأخر» للانتقال إلى التالي</p>
          </div>
          <button
            type="button"
            aria-label="إخفاء تنبيه النداء"
            onClick={() => setCallBanner(null)}
            className="rounded-lg p-1 text-slate-500 hover:bg-amber-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* المريض الجالس الآن أمام الطبيب */}
      {current ? (
        <Card className="border-primary-200 bg-primary-50">
          <p className="text-xs font-semibold text-primary-700">المريض الحالي</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{patientName(current)}</p>
          <p className="text-sm text-slate-600">
            موعده {current.startTime}
            {patientPhone(current) ? <> · <span className="ltr-nums">{patientPhone(current)}</span></> : null}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {/* إنهاء الموعد للطبيب وحده — لا يظهر في صفحة المساعد (والخادم يرفضه له أيضًا). */}
            {!isAssistant && (
              <Button
                loading={finish.isPending}
                disabled={busy}
                onClick={() => run(finish.mutateAsync(current.id), "تم إنهاء الموعد.", "تعذّر إنهاء الموعد.")}
              >
                <CheckCircle2 className="ml-1.5 h-4 w-4" /> أنهى الموعد
              </Button>
            )}
            {canManageAttendance && <Button
              variant="outline"
              className={isAssistant ? "col-span-2" : undefined}
              loading={markLate.isPending || callNext.isPending}
              disabled={busy}
              title="غير موجود — يُسجَّل متأخرًا ويُنادى المريض التالي مباشرة"
              onClick={async () => {
                markSelfAction();
                // هل بقي في الطابور غير هذا المريض؟ إن لم يبق أحد لا نناديه هو نفسه من جديد.
                const others = (ordered ?? [...waiting, ...late]).filter((a) => a.id !== current.id);
                let res: unknown;
                try {
                  res = await markLate.mutateAsync(current.id);
                } catch (err) {
                  showToast(apiErrorMessage(err, "تعذّر تسجيله كمتأخر."), "error");
                  return;
                }
                // المريض التالي يجب أن يكون شخصًا آخر: منتظر عادي، أو متأخر آخر رصيده أقل من رصيد هذا المريض الآن.
                const penalty = (res as { lateEvent?: { penalty?: number } | null } | undefined)?.lateEvent?.penalty ?? 2;
                const hasSomeoneElse = others.some((a) => a.status !== "LATE" || (a.skipCredits ?? 0) < penalty);
                if (!hasSomeoneElse) {
                  showToast(lateToast(res), "success");
                  return;
                }
                // الانتقال مباشرة إلى المريض الذي بعده (نفس قاعدة «نادِ المريض التالي» في الخادم).
                try {
                  markSelfAction();
                  const next = (await callNext.mutateAsync()) as Appointment | undefined;
                  setCallBanner(null);
                  showToast(
                    "سُجّل متأخرًا — " + (next ? "تمت مناداة التالي: " + patientName(next) : "تمت مناداة المريض التالي."),
                    "success"
                  );
                } catch (err) {
                  showToast(lateToast(res) + " " + apiErrorMessage(err, "تعذّرت مناداة التالي تلقائيًا — اضغط «نادِ المريض التالي»."), "error");
                }
              }}
            >
              <Clock3 className="ml-1.5 h-4 w-4" /> متأخر
            </Button>}
            {/* نودي عليه فلم يحضر: رسالة جاهزة من هاتف المساعد + بقاؤه في المتابعة.
                لا تسجيل غياب نهائي هنا — ذلك يحدث وحده عند انتهاء دوام الطبيب. */}
            {canManageAttendance && <Button
              variant="outline"
              className="col-span-2 border-red-200 text-red-600 hover:bg-red-50"
              disabled={busy}
              title="لم يستجب للنداء — إشعاره برسالة دون تسجيل غياب نهائي"
              onClick={() => openNoShow(current)}
            >
              <UserX className="ml-1.5 h-4 w-4" /> لم يحضر — إشعاره برسالة
            </Button>}
          </div>
        </Card>
      ) : (
        <Card className="text-center">
          <p className="text-sm text-slate-600">لا يوجد مريض بالداخل الآن.</p>
          <Button
            className="mt-3 w-full"
            loading={callNext.isPending}
            disabled={busy || (waiting.length === 0 && late.length === 0)}
            onClick={() => run(callNext.mutateAsync(), "تمت مناداة المريض التالي.", "تعذّرت مناداة المريض التالي.")}
          >
            <PhoneCall className="ml-1.5 h-4 w-4" /> نادِ المريض التالي
          </Button>
        </Card>
      )}

      {/* قائمة الانتظار بالترتيب */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
          <Users className="h-4 w-4" /> في الانتظار ({queueList.length})
        </p>
        {queueList.length === 0 ? (
          summary && summary.total === 0 ? (
            <EmptyState title="لا توجد مواعيد اليوم" />
          ) : summary && !current && summary.completed + summary.noShow + summary.cancelled === summary.total ? (
            <EmptyState
              title="اكتملت مواعيد اليوم"
              description={`${summary.completed} مكتملة${summary.noShow ? ` · ${summary.noShow} لم يحضروا` : ""}${summary.cancelled ? ` · ${summary.cancelled} ملغاة` : ""}`}
            />
          ) : (
            <EmptyState title="لا يوجد منتظرون الآن" description={summary?.pending ? `${summary.pending} بانتظار التأكيد.` : undefined} />
          )
        ) : (
          <div className="space-y-2">
            {queueList.map((a, i) => {
              const isLate = a.status === "LATE";
              const remaining = a.skipCredits ?? 0;
              return (
              <Card key={a.id} className={"flex items-center justify-between gap-3 py-3" + (isLate ? " border-amber-200 bg-amber-50" : "")}>
                <div className="flex items-center gap-3">
                  <span
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold " +
                      (isLate ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")
                    }
                  >
                    {(a as Appointment & { position?: number }).position ?? i + 1}
                  </span>
                  <div>
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800">
                      {patientName(a)}
                      {isLate && (
                        <span className="rounded-md bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                          متأخر — ليس غيابًا نهائيًا
                        </span>
                      )}
                    </p>
                    <p className={"text-xs " + (isLate ? "text-amber-700" : "text-slate-500")}>
                      {a.startTime}
                      {isLate && (remaining > 0 ? " · يعود دوره بعد " + patientsCount(remaining) : " · دوره التالي مباشرة")}
                      {isLate && a.deferredCount ? " · تأخّر " + a.deferredCount + " مرة" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {a.arrivedAt ? (
                    <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-600">
                      <UserCheck className="h-4 w-4" /> وصل
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      title="تسجيل وصول المريض إلى العيادة"
                      aria-label={`تسجيل وصول ${patientName(a)}`}
                      onClick={() => run(markArrived.mutateAsync(a.id), "تم تسجيل وصوله.", "تعذّر تسجيل وصوله.")}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
                    >
                      <UserCheck className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || Boolean(current)}
                    onClick={() => run(callPatient.mutateAsync(a.id), "تمت مناداته.", "تعذّرت مناداته.")}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-primary-600 transition hover:bg-primary-50 disabled:opacity-40"
                  >
                    {isLate ? "نادِه الآن" : "نادِه"}
                  </button>
                  {isLate && (
                    <button
                      type="button"
                      disabled={busy}
                      title="لم يستجب — إشعاره برسالة دون تسجيل غياب نهائي"
                      aria-label={`إشعار ${patientName(a)} برسالة`}
                      onClick={() => openNoShow(a)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-white disabled:opacity-40"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* المتأخرون كقائمة منفصلة — فقط مع خادم قديم لا يرسل الترتيب الموحّد (ordered) */}
      {!ordered && late.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-amber-700">
            <Clock3 className="h-4 w-4" /> متأخرون ({late.length})
          </p>
          <div className="space-y-2">
            {late.map((a) => {
              const remaining = a.skipCredits ?? 0;
              return (
                <Card key={a.id} className="flex items-center justify-between gap-3 border-amber-200 bg-amber-50 py-3">
                  <div>
                    <p className="font-semibold text-slate-800">{patientName(a)}</p>
                    <p className="text-xs text-amber-700">
                      {remaining > 0 ? "يعود دوره بعد " + patientsCount(remaining) : "دوره التالي مباشرة"}
                      {a.deferredCount ? " · تأجّل " + a.deferredCount + " مرة" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || Boolean(current)}
                      onClick={() => run(callPatient.mutateAsync(a.id), "تمت مناداته.", "تعذّرت مناداته.")}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-primary-600 transition hover:bg-white disabled:opacity-40"
                    >
                      نادِه الآن
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title="لم يستجب — إشعاره برسالة دون تسجيل غياب نهائي"
                      aria-label={`إشعار ${patientName(a)} برسالة`}
                      onClick={() => openNoShow(a)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-white disabled:opacity-40"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}