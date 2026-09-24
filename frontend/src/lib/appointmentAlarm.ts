// رنة تنبيه «موعدك مع الطبيب بعد 5 دقائق» داخل التطبيق (حين تكون صفحة مادبوك مفتوحة).
//
// المسار: الخادم يرسل Push من النوع APPOINTMENT_5MIN_ALARM → الـService Worker (public/sw.js) يعرض الإشعار
// ثم يرسل رسالة MB_APPOINTMENT_ALARM إلى الصفحات المفتوحة → هنا نشغّل ملف الرنة الخاص مرة واحدة.
//
// حدود حقيقية (لا ادعاء بغيرها):
//  - Web Push لا يسمح بملف صوت مخصّص للإشعار نفسه؛ في الخلفية/شاشة القفل يُسمع صوت إشعارات المتصفح
//    الافتراضي للموقع. الرنة الخاصة هنا تعمل فقط والصفحة مفتوحة وظاهرة.
//  - المتصفحات تمنع تشغيل الصوت قبل أي تفاعل للمستخدم مع الصفحة؛ نحضّر الصوت عند أول لمسة، وإن رُفض
//    التشغيل يبقى الإشعار نفسه ظاهرًا كالمعتاد.
//  - لا تتجاوز الرنة الوضع الصامت أو «عدم الإزعاج» (مستوى صوت الوسائط في الجهاز هو ما يُطبَّق).

export const ALARM_SOUND_URL = "/sounds/appointment-alarm.wav";
export const ALARM_MESSAGE_TYPE = "MB_APPOINTMENT_ALARM";
const PLAYED_KEY = "mb-alarm-played";
const PLAYED_MAX = 50;

export const QUEUE_APPROACH_KIND = "QUEUE_APPROACH_ALARM";

export interface AlarmMessage {
  type: typeof ALARM_MESSAGE_TYPE;
  /** APPOINTMENT_5MIN_ALARM (أو غائب في رسائل v5) أو QUEUE_APPROACH_ALARM («دورك اقترب»). */
  kind?: string;
  appointmentId: string | null;
  title?: string;
  body?: string;
}

export function isAlarmMessage(data: unknown): data is AlarmMessage {
  return Boolean(data && typeof data === "object" && (data as { type?: unknown }).type === ALARM_MESSAGE_TYPE);
}

function readPlayed(): string[] {
  try {
    const raw = window.localStorage.getItem(PLAYED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * true إن لم تُشغَّل الرنة لهذا (الموعد + نوع التنبيه) على هذا الجهاز من قبل (ويسجّلها). حماية ثانية فقط —
 * المصدر الموثوق لمنع التكرار هو سجل التذكير في قاعدة البيانات، ثم سجل الـService Worker.
 */
export function claimAlarmPlayback(appointmentId: string | null, kind?: string): boolean {
  if (!appointmentId) return true;
  const key = kind === QUEUE_APPROACH_KIND ? `approach:${appointmentId}` : appointmentId;
  const played = readPlayed();
  if (played.includes(key)) return false;
  try {
    window.localStorage.setItem(PLAYED_KEY, JSON.stringify([...played, key].slice(-PLAYED_MAX)));
  } catch {
    // التخزين غير متاح (نافذة خاصة): الـService Worker ما زال يمنع التكرار.
  }
  return true;
}

let audio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!audio) {
    audio = new Audio(ALARM_SOUND_URL);
    audio.preload = "auto";
    audio.loop = false; // مرة واحدة فقط — لا تكرار بلا توقف.
  }
  return audio;
}

/** تشغيل الرنة مرة واحدة (≈3 ثوانٍ). لا ترمي استثناءً أبدًا. */
export async function playAlarmOnce(): Promise<boolean> {
  const a = getAudio();
  if (!a) return false;
  try {
    a.pause();
    a.currentTime = 0;
    a.volume = 1;
    a.muted = false;
    await a.play();
    try {
      navigator.vibrate?.([700, 250, 700, 250, 700]);
    } catch {
      /* غير مدعوم */
    }
    return true;
  } catch {
    return false;
  }
}

/** يحضّر عنصر الصوت ضمن أول تفاعل للمستخدم حتى يُسمح بتشغيله لاحقًا (سياسة التشغيل التلقائي). */
function primeOnFirstGesture() {
  const prime = () => {
    const a = getAudio();
    if (a) {
      a.muted = true;
      a.play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {
          a.muted = false;
        });
    }
    window.removeEventListener("pointerdown", prime, true);
    window.removeEventListener("keydown", prime, true);
  };
  window.addEventListener("pointerdown", prime, true);
  window.addEventListener("keydown", prime, true);
}

/**
 * يستمع لرسائل الـService Worker. يعيد دالة لإلغاء الاستماع.
 * onAlarm يُستدعى مرة واحدة لكل موعد (لإظهار تنبيه داخل الصفحة)، والرنة تُشغَّل فقط والصفحة ظاهرة.
 */
export function installAppointmentAlarm(onAlarm: (msg: AlarmMessage) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  primeOnFirstGesture();
  const handler = (event: MessageEvent) => {
    if (!isAlarmMessage(event.data)) return;
    if (!claimAlarmPlayback(event.data.appointmentId, event.data.kind)) return;
    onAlarm(event.data);
    if (document.visibilityState === "visible") void playAlarmOnce();
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
