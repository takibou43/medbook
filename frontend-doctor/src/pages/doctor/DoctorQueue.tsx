import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Clock3, PhoneCall, UserX, Users } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner, EmptyState } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { disablePush, enablePush, isPushSubscribed, pushSupported } from "../../lib/push";
import { useCallNext, useCallPatient, useFinishAppointment, useMarkLate, useMarkNoShow, useQueue } from "../../hooks/useQueue";
import { Appointment } from "../../types";

// المريض قد يكون صاحب حساب أو ضيفًا حجز باسمه فقط — نعرض الاسم المتوفر أيًّا كان مصدره.
function patientName(a: Appointment): string {
  if (a.patient) return a.patient.firstName + " " + a.patient.lastName;
  const guest = [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ").trim();
  return guest || "مريض بدون اسم";
}

function patientPhone(a: Appointment): string | null {
  return a.patient?.user?.phone ?? a.guestPhone ?? null;
}

export default function DoctorQueue() {
  const { showToast } = useToast();
  const { data, isLoading, isFetching } = useQueue();

  const callNext = useCallNext();
  const callPatient = useCallPatient();
  const markLate = useMarkLate();
  const finish = useFinishAppointment();
  const noShow = useMarkNoShow();

  const busy =
    callNext.isPending || callPatient.isPending || markLate.isPending || finish.isPending || noShow.isPending;

  // حالة إشعارات هذا الجهاز تحديدًا (وليس الحساب): قد يفعّلها على هاتفه دون حاسوب العيادة.
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">طابور اليوم</h1>
          <p className="text-sm text-slate-500">
            {waiting.length} في الانتظار · {late.length} متأخرون
            {isFetching ? " · جارٍ التحديث..." : ""}
          </p>
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
              onClick={() =>
                run(
                  markLate.mutateAsync(current.id),
                  "نُقل إلى قائمة المتأخرين، ويعود دوره بعد مريضين.",
                  "تعذّر تسجيله كمتأخر."
                )
              }
            >
              <Clock3 className="ml-1.5 h-4 w-4" /> لم يستجب
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
          <Users className="h-4 w-4" /> في الانتظار ({waiting.length})
        </p>
        {waiting.length === 0 ? (
          <EmptyState title="لا أحد في الانتظار" description="كل مواعيد اليوم عولجت أو لم يحن وقتها بعد." />
        ) : (
          <div className="space-y-2">
            {waiting.map((a, i) => (
              <Card key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">{patientName(a)}</p>
                    <p className="text-xs text-slate-500">{a.startTime}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || Boolean(current)}
                  onClick={() => run(callPatient.mutateAsync(a.id), "تمت مناداته.", "تعذّرت مناداته.")}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-primary-600 transition hover:bg-primary-50 disabled:opacity-40"
                >
                  نادِه
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* المتأخرون: لم يُشطبوا، ويعود دور كل واحد تلقائيًا بعد مريضين */}
      {late.length > 0 && (
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
                      {remaining > 0
                        ? "يعود دوره بعد " + remaining + (remaining === 1 ? " مريض" : " مريضين")
                        : "دوره التالي مباشرة"}
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
                      title="تسجيله كغائب نهائيًا"
                      onClick={() => run(noShow.mutateAsync(a.id), "سُجّل كغائب.", "تعذّر تسجيله كغائب.")}
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
