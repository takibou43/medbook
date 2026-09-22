import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Clock3, PhoneCall, UserCheck, UserX, Users } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner, EmptyState } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { disablePush, enablePush, isPushSubscribed, pushSupported } from "../../lib/push";
import { useCallNext, useCallPatient, useFinishAppointment, useMarkArrived, useMarkLate, useQueue } from "../../hooks/useQueue";
import { NoShowSmsDialog, NoShowTarget } from "../../components/NoShowSmsDialog";
import { Appointment } from "../../types";

// المريض قد يكون صاحب حساب أو ضيفًا حجز باسمه فقط — نعرض الاسم المتوفر أيًّا كان مصدره.
function patientName(a: Appointment): string {
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

export default function DoctorQueue() {
  const { showToast } = useToast();
  const { data, isLoading, isFetching } = useQueue();

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
    try {
      const res = await markLate.mutateAsync(id);
      showToast(lateToast(res), "success");
      return res;
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر نقله إلى قائمة المتأخرين."), "error");
      throw err;
    }
  }

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
  const estimatedDurationMinutes = data?.estimatedDurationMinutes ?? null;
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
          <p className="text-sm text-slate-500">
            {waiting.length} في الانتظار · {late.length} متأخرون
            {isFetching ? " · جارٍ التحديث..." : ""}
          </p>
          {estimatedDurationMinutes !== null && (
            <p className="mt-0.5 text-xs text-slate-400">
              الوقت المتوقع للجلسة القادمة: ~{estimatedDurationMinutes} دقيقة (مدة ذكية اعتمادًا على آخر الجلسات)
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

      {/* المريض الجالس الآن أمام الطبيب */}
      {current ? (
        <Card className="border-primary-200 bg-primary-50">
          <p className="text-xs font-semibold text-primary-700">المريض الحالي</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{patientName(current)}</p>
          <p className="text-sm text-slate-600">
            موعده {current.startTime}
            {patientPhone(current) ? " · " + patientPhone(current) : ""}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              loading={finish.isPending}
              disabled={busy}
              onClick={() => run(finish.mutateAsync(current.id), "تم إنهاء الموعد.", "تعذّر إنهاء الموعد.")}
            >
              <CheckCircle2 className="ml-1.5 h-4 w-4" /> أنهى الموعد
            </Button>
            <Button
              variant="outline"
              loading={markLate.isPending}
              disabled={busy}
              onClick={async () => {
                try {
                  const res = await markLate.mutateAsync(current.id);
                  showToast(lateToast(res), "success");
                } catch (err) {
                  showToast(apiErrorMessage(err, "تعذّر تسجيله كمتأخر."), "error");
                }
              }}
            >
              <Clock3 className="ml-1.5 h-4 w-4" /> متأخر
            </Button>
            {/* نودي عليه فلم يحضر: رسالة جاهزة من هاتف المساعد + بقاؤه في المتابعة.
                لا تسجيل غياب نهائي هنا — ذلك يحدث وحده عند انتهاء دوام الطبيب. */}
            <Button
              variant="outline"
              className="col-span-2 border-red-200 text-red-600 hover:bg-red-50"
              disabled={busy}
              title="لم يستجب للنداء — إشعاره برسالة دون تسجيل غياب نهائي"
              onClick={() => openNoShow(current)}
            >
              <UserX className="ml-1.5 h-4 w-4" /> لم يحضر — إشعاره برسالة
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="text-center">
          <p className="text-sm text-slate-500">لا يوجد مريض بالداخل الآن.</p>
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
          <EmptyState title="لا أحد في الانتظار" description="كل مواعيد اليوم عولجت أو لم يحن وقتها بعد." />
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