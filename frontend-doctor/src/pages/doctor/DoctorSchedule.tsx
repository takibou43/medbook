import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { Input, Select } from "../../components/ui/Input";
import { DateField } from "../../components/ui/DateField";
import { scheduleError, formatDayAr } from "../../lib/doctorUi";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

interface Block {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export default function DoctorSchedule() {
  const { data: schedule, isLoading, isError, refetch } = useQuery({
    queryKey: ["doctor-schedule"],
    queryFn: async () => (await api.get("/doctor/schedule")).data.data,
  });
  const profile = useQuery({ queryKey: ["me-doctor-profile"], queryFn: async () => (await api.get("/auth/me")).data.data });
  const [duration, setDuration] = useState(7);
  const [durationDirty, setDurationDirty] = useState(false);
  const [savingDuration, setSavingDuration] = useState(false);
  useEffect(() => { if (profile.data?.doctor && !durationDirty) setDuration(profile.data.doctor.slotDurationMin ?? 7); }, [profile.data, durationDirty]);
  async function saveDuration() {
    if (savingDuration) return;
    setSavingDuration(true);
    try { await api.patch("/doctor/profile", { slotDurationMin: duration }); await profile.refetch(); setDurationDirty(false); showToast("تم حفظ مدة الموعد للحجوزات الجديدة.", "success"); }
    catch (err) { showToast(apiErrorMessage(err), "error"); }
    finally { setSavingDuration(false); }
  }
  const { showToast } = useToast();
  const qc = useQueryClient();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [savedBlocks, setSavedBlocks] = useState("[]");
  const [dirty, setDirty] = useState(false);
  const [copyDay, setCopyDay] = useState(0);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const [exceptionSaving, setExceptionSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exceptionDate, setExceptionDate] = useState("");
  const [exceptionOff, setExceptionOff] = useState(true);

  useEffect(() => {
    if (schedule && !dirty) {
      const next = schedule.filter((s: any) => !s.isException).map((s: any) => ({dayOfWeek:s.dayOfWeek,startTime:s.startTime,endTime:s.endTime}));
      setBlocks(next); setSavedBlocks(JSON.stringify(next));
    }
  }, [schedule, dirty]);

  const validation = scheduleError(blocks);
  const hasChanges = JSON.stringify(blocks.map(({dayOfWeek,startTime,endTime}) => ({dayOfWeek,startTime,endTime}))) !== savedBlocks;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (hasChanges || durationDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges, durationDirty]);
  function copyHours() {
    if (!copyTargets.length) return;
    const source = blocks.filter(b => b.dayOfWeek === copyDay);
    setDirty(true);
    setBlocks(b => [...b.filter(x => !copyTargets.includes(x.dayOfWeek)), ...copyTargets.flatMap(dayOfWeek => source.map(x => ({dayOfWeek,startTime:x.startTime,endTime:x.endTime})))]);
    setCopyTargets([]);
  }

  function addBlock() {
    setDirty(true);
    setBlocks((b) => [...b, { dayOfWeek: 0, startTime: "08:00", endTime: "12:00" }]);
  }

  function updateBlock(index: number, patch: Partial<Block>) {
    setDirty(true);
    setBlocks((b) => b.map((blk, i) => (i === index ? { ...blk, ...patch } : blk)));
  }

  function removeBlock(index: number) {
    setDirty(true);
    setBlocks((b) => b.filter((_, i) => i !== index));
  }

  async function saveWeeklySchedule() {
    if (saving || validation || !hasChanges) return;
    setSaving(true);
    try {
      const payload = { blocks: blocks.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime })) };
      let changed = 0;
      try {
        await api.put("/doctor/schedule", payload);
      } catch (err: any) {
        const details = err?.response?.data?.details;
        if (err?.response?.status !== 409 || details?.code !== "APPOINTMENTS_REQUIRE_RESCHEDULE") throw err;
        const count = Number(details.affectedCount) || 0;
        if (!window.confirm(`سيصبح ${count} موعدًا محجوزًا بحاجة إلى إعادة جدولة، وسيتم إشعار المرضى. هل تريد المتابعة؟`)) return;
        const res = await api.put("/doctor/schedule", { ...payload, confirmAffected: true });
        changed = Number(res?.data?.data?.affectedAppointments) || 0;
      }
      showToast(changed > 0 ? `تم حفظ جدول العمل. ${changed} موعدًا بحاجة إلى إعادة جدولة وأُشعر أصحابها.` : "تم حفظ جدول العمل.", "success");
      setSavedBlocks(JSON.stringify(blocks.map(({dayOfWeek,startTime,endTime}) => ({dayOfWeek,startTime,endTime}))));
      await qc.invalidateQueries({ queryKey: ["doctor-schedule"] });
      setDirty(false);
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function addException() {
    if (exceptionSaving) return;
    if (!exceptionDate) {
      showToast("الرجاء اختيار تاريخ.", "error");
      return;
    }
    setExceptionSaving(true);
    try {
      const payload = { exceptionDate, isOff: exceptionOff };
      let changed = 0;
      try {
        await api.post("/doctor/schedule/exceptions", payload);
      } catch (err: any) {
        const details = err?.response?.data?.details;
        if (err?.response?.status !== 409 || details?.code !== "APPOINTMENTS_REQUIRE_RESCHEDULE") throw err;
        const count = Number(details.affectedCount) || 0;
        const warning = exceptionOff
          ? `يوجد ${count} موعدًا محجوزًا في هذا اليوم. ستُلغى هذه المواعيد نهائيًا وسيتم إشعار المرضى لحجز موعد جديد. هل تريد جعله يوم عطلة؟`
          : `يوجد ${count} موعدًا سيتأثر بساعات العمل الجديدة، وسيتم إشعار المرضى لإعادة الجدولة. هل تريد المتابعة؟`;
        if (!window.confirm(warning)) return;
        const res = await api.post("/doctor/schedule/exceptions", { ...payload, confirmAffected: true });
        changed = Number(res?.data?.data?.affectedAppointments) || 0;
      }
      showToast(
        changed === 0
          ? "تم إضافة الاستثناء."
          : exceptionOff
            ? `تم تسجيل العطلة. أُلغي ${changed} موعدًا نهائيًا وأُشعر المرضى.`
            : `تم إضافة الاستثناء. ${changed} موعدًا بحاجة إلى إعادة جدولة وأُشعر أصحابها.`,
        "success"
      );
      setExceptionDate("");
      qc.invalidateQueries({ queryKey: ["doctor-schedule"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally { setExceptionSaving(false); }
  }

  if (isLoading) return <Spinner />;
  if (isError && !schedule) return <div role="alert">تعذر تحميل أوقات العمل. <Button onClick={() => void refetch()}>إعادة المحاولة</Button></div>;

  const exceptions = (schedule ?? []).filter((s: any) => s.isException);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">أوقات العمل</h1>

      <section className="card space-y-3 p-5" aria-label="مدة الموعد">
        <h2 className="font-bold">مدة الموعد</h2>
        <Select label="مدة الموعد للحجوزات الجديدة" value={duration} onChange={e => {setDurationDirty(true);setDuration(Number(e.target.value));}} disabled={savingDuration || profile.isPending || profile.isError}>
          {[5, 7, 10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} دقيقة</option>)}
        </Select>
        <p className="text-sm text-slate-600">تُستخدم لتوزيع الحجوزات الجديدة. تبقى المواعيد المحجوزة بأوقاتها الحالية.</p>
        {profile.isError && <p role="alert">تعذر تحميل مدة الموعد. <button onClick={() => void profile.refetch()}>إعادة المحاولة</button></p>}
        <p role="status" className="text-xs text-slate-600">{durationDirty ? "مدة الموعد لم تُحفظ بعد" : "مدة الموعد محفوظة"}</p>
        <Button onClick={saveDuration} loading={savingDuration} disabled={!durationDirty || profile.isPending || profile.isError}>حفظ مدة الموعد</Button>
      </section>
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">الجدول الأسبوعي</h2>
          <Button variant="outline" onClick={addBlock} disabled={saving}>
            <Plus className="h-4 w-4" />
            إضافة فترة
          </Button>
        </div>

        <p role="status" className="mb-3 text-sm text-slate-600">{hasChanges ? 'تعديلات لم تُحفظ بعد' : 'الجدول مطابق لآخر نسخة محفوظة'} · الفراغ بين فترتين استراحة.</p>
        <fieldset disabled={saving} className="space-y-3">
          {[6,0,1,2,3,4,5].map(day => <section key={day} className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{DAYS[day]} <span className="text-sm font-normal text-slate-500">{blocks.some(b => b.dayOfWeek === day) ? '' : 'عطلة'}</span></h3><Button variant="outline" onClick={() => {setDirty(true);setBlocks(b => [...b,{dayOfWeek:day,startTime:'08:00',endTime:'12:00'}]);}}>إضافة فترة</Button></div>
            {blocks.map((b,i) => ({b,i})).filter(({b}) => b.dayOfWeek === day).map(({b,i}) => <div key={i} className="mt-3 flex flex-wrap items-center gap-2"><label className="text-sm">من <input aria-label={DAYS[day]+' بداية الفترة'} type="time" className="input !w-auto" value={b.startTime} onChange={e => updateBlock(i,{startTime:e.target.value})}/></label><label className="text-sm">إلى <input aria-label={DAYS[day]+' نهاية الفترة'} type="time" className="input !w-auto" value={b.endTime} onChange={e => updateBlock(i,{endTime:e.target.value})}/></label><button aria-label={'حذف فترة '+DAYS[day]} onClick={() => removeBlock(i)} className="rounded-xl p-3 text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4"/></button></div>)}
          </section>)}
          <details className="rounded-xl bg-slate-50 p-3"><summary className="font-semibold">نسخ أوقات يوم إلى أيام أخرى</summary><div className="mt-3 space-y-3"><Select label="اليوم المصدر" value={copyDay} onChange={e => {setCopyDay(Number(e.target.value));setCopyTargets([]);}}>{DAYS.map((d,i) => <option key={i} value={i}>{d}</option>)}</Select><p className="text-sm text-slate-600">يستبدل فترات الأيام المختارة في المسودة. نسخ يوم عطلة يمسح فتراتها؛ لا يتغير الجدول حتى تحفظه.</p><div className="flex flex-wrap gap-3">{DAYS.map((d,i) => i !== copyDay && <label key={i} className="flex items-center gap-2"><input type="checkbox" checked={copyTargets.includes(i)} onChange={e => setCopyTargets(t => e.target.checked ? [...t,i] : t.filter(x => x !== i))}/>{d}</label>)}</div><Button variant="outline" disabled={!copyTargets.length} onClick={copyHours}>نسخ إلى المسودة</Button></div></details>
        </fieldset>
        {validation && <p role="alert" className="mt-3 text-sm text-red-700">{validation}</p>}

        <Button className="mt-4" onClick={saveWeeklySchedule} loading={saving} disabled={!hasChanges || Boolean(validation)}>
          حفظ الجدول الأسبوعي
        </Button>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900">إجازات وأيام استثنائية</h2>
        <div className="flex flex-wrap items-end gap-3">
          <DateField label="التاريخ" value={exceptionDate} onChange={(value) => setExceptionDate(value ?? "")} />
          <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-600">
            <input type="checkbox" checked={exceptionOff} onChange={(e) => setExceptionOff(e.target.checked)} />
            يوم عطلة كامل
          </label>
          <Button onClick={addException} loading={exceptionSaving}>إضافة</Button>
        </div>

        {exceptions.length > 0 && (
          <div className="mt-4 space-y-2">
            {exceptions.map((ex: any) => (
              <div key={ex.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2 text-sm">
                <span>
                  {formatDayAr(ex.exceptionDate.slice(0, 10))} — {ex.isOff ? "عطلة" : `${ex.startTime} - ${ex.endTime}`}
                </span>
                <button
                  onClick={async () => {
                    await api.delete(`/doctor/schedule/${ex.id}`);
                    qc.invalidateQueries({ queryKey: ["doctor-schedule"] });
                  }}
                  aria-label="حذف الإجازة أو اليوم الاستثنائي"
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
