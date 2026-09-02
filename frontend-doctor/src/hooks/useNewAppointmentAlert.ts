import { useEffect, useRef } from "react";
import { Appointment } from "../types";

// نغمة تنبيه قصيرة مولّدة برمجيًا (بدون ملف صوت خارجي).
function playBeep() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close();
  } catch {
    // الصوت رفاهية فقط — نتجاهل أي خطأ (سياسات تشغيل الصوت في المتصفح).
  }
}

function notifyDesktop(title: string, body: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "/logo.svg" });
  } catch {
    // تجاهل — الإشعار غير أساسي.
  }
}

/**
 * يراقب قائمة المواعيد ويُنبّه عند وصول حجز جديد لم يكن موجودًا في آخر تحديث.
 * لا ينبّه عند أول تحميل للصفحة (وإلا لاعتُبرت كل المواعيد القديمة "جديدة").
 */
export function useNewAppointmentAlert(
  appointments: Appointment[] | undefined,
  onNew: (count: number, latest?: Appointment) => void
) {
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!appointments) return;

    if (knownIds.current === null) {
      knownIds.current = new Set(appointments.map((a) => a.id));
      return;
    }

    const fresh = appointments.filter((a) => !knownIds.current!.has(a.id));
    if (fresh.length > 0) {
      const latest = fresh[0];
      const name = latest.patient
        ? `${latest.patient.firstName} ${latest.patient.lastName}`
        : `${latest.guestFirstName ?? ""} ${latest.guestLastName ?? ""}`.trim();
      playBeep();
      notifyDesktop(
        fresh.length === 1 ? "حجز جديد" : `${fresh.length} حجوزات جديدة`,
        `${name} — ${new Date(latest.date).toLocaleDateString("ar-DZ")} الساعة ${latest.startTime}`
      );
      onNew(fresh.length, latest);
    }

    knownIds.current = new Set(appointments.map((a) => a.id));
  }, [appointments, onNew]);
}

// طلب إذن إشعارات سطح المكتب مرة واحدة (يُستدعى بنقرة من المستخدم).
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported" as const;
  if (Notification.permission === "granted") return "granted" as const;
  if (Notification.permission === "denied") return "denied" as const;
  return (await Notification.requestPermission()) as "granted" | "denied" | "default";
}
