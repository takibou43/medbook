import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { Input } from "../../components/ui/Input";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

interface Block {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export default function DoctorSchedule() {
  const { data: schedule, isLoading } = useQuery({
    queryKey: ["doctor-schedule"],
    queryFn: async () => (await api.get("/doctor/schedule")).data.data,
  });
  const { showToast } = useToast();
  const qc = useQueryClient();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saving, setSaving] = useState(false);
  const [exceptionDate, setExceptionDate] = useState("");
  const [exceptionOff, setExceptionOff] = useState(true);

  useEffect(() => {
    if (schedule) {
      setBlocks(
        schedule
          .filter((s: any) => !s.isException)
          .map((s: any) => ({ id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime }))
      );
    }
  }, [schedule]);

  function addBlock() {
    setBlocks((b) => [...b, { dayOfWeek: 0, startTime: "08:00", endTime: "12:00" }]);
  }

  function updateBlock(index: number, patch: Partial<Block>) {
    setBlocks((b) => b.map((blk, i) => (i === index ? { ...blk, ...patch } : blk)));
  }

  function removeBlock(index: number) {
    setBlocks((b) => b.filter((_, i) => i !== index));
  }

  async function saveWeeklySchedule() {
    setSaving(true);
    try {
      await api.put("/doctor/schedule", { blocks: blocks.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime })) });
      showToast("تم حفظ جدول العمل.", "success");
      qc.invalidateQueries({ queryKey: ["doctor-schedule"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function addException() {
    if (!exceptionDate) {
      showToast("الرجاء اختيار تاريخ.", "error");
      return;
    }
    try {
      await api.post("/doctor/schedule/exceptions", { exceptionDate, isOff: exceptionOff });
      showToast("تم إضافة الاستثناء.", "success");
      setExceptionDate("");
      qc.invalidateQueries({ queryKey: ["doctor-schedule"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  if (isLoading) return <Spinner />;

  const exceptions = (schedule ?? []).filter((s: any) => s.isException);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">أوقات العمل</h1>

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">الجدول الأسبوعي</h2>
          <Button variant="outline" onClick={addBlock}>
            <Plus className="h-4 w-4" />
            إضافة فترة
          </Button>
        </div>

        <div className="space-y-3">
          {blocks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3">
              <select className="input !w-auto" value={b.dayOfWeek} onChange={(e) => updateBlock(i, { dayOfWeek: Number(e.target.value) })}>
                {DAYS.map((d, idx) => (
                  <option key={idx} value={idx}>
                    {d}
                  </option>
                ))}
              </select>
              <input type="time" className="input !w-auto" value={b.startTime} onChange={(e) => updateBlock(i, { startTime: e.target.value })} />
              <span className="text-slate-400">إلى</span>
              <input type="time" className="input !w-auto" value={b.endTime} onChange={(e) => updateBlock(i, { endTime: e.target.value })} />
              <button onClick={() => removeBlock(i)} className="mr-auto rounded-lg p-2 text-red-500 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {blocks.length === 0 && <p className="text-sm text-slate-500">لا توجد فترات عمل محددة بعد.</p>}
        </div>

        <Button className="mt-4" onClick={saveWeeklySchedule} loading={saving}>
          حفظ الجدول الأسبوعي
        </Button>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900">إجازات وأيام استثنائية</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="التاريخ" type="date" value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)} />
          <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-600">
            <input type="checkbox" checked={exceptionOff} onChange={(e) => setExceptionOff(e.target.checked)} />
            يوم عطلة كامل
          </label>
          <Button onClick={addException}>إضافة</Button>
        </div>

        {exceptions.length > 0 && (
          <div className="mt-4 space-y-2">
            {exceptions.map((ex: any) => (
              <div key={ex.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2 text-sm">
                <span>
                  {new Date(ex.exceptionDate).toLocaleDateString("ar-DZ")} — {ex.isOff ? "عطلة" : `${ex.startTime} - ${ex.endTime}`}
                </span>
                <button
                  onClick={async () => {
                    await api.delete(`/doctor/schedule/${ex.id}`);
                    qc.invalidateQueries({ queryKey: ["doctor-schedule"] });
                  }}
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
