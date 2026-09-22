import { AppointmentStatus } from "@prisma/client";

/**
 * ترتيب طابور اليوم — منطق واحد مشترك (دوال نقية بلا قاعدة بيانات) يستعمله:
 *   - callNextPatient: من يُنادى الآن (أول عنصر).
 *   - getQueueForDoctor: الترتيب المعروض للطبيب والمساعد.
 *   - حالة الدور للمريض: كم شخصًا يسبقه.
 *
 * الأساس هو النظام الموجود أصلًا دون إعادة بنائه: الترتيب حسب وقت الموعد (startTime)، والمتأخر (LATE)
 * يحمل "رصيد تخطٍّ" skipCredits = عدد المرضى الذين يُنادَون قبله، ويُنقص رصيد كل المتأخرين بواحد مع
 * كل مناداة. أي أن skipCredits هو بالضبط عدد المراكز التي يتراجعها المتأخر في الطابور.
 *
 * الإضافة الوحيدة هنا: إن لم يبق في الانتظار من يستهلك رصيد المتأخرين (مثلًا بقي متأخرون فقط)،
 * لا يعلق الطابور: يُنادى المتأخر الأقل رصيدًا (ثم الأبكر موعدًا، ثم المعرّف) — أي أن التراجع لا
 * يتجاوز حدود الطابور الفعلية. الترتيب حتمي بالكامل (لا عشوائية ولا اعتماد على ترتيب الطلبات).
 */

// عقوبة التأخير بالمراكز (وليست دقائق): التأخير الأول يتراجع مركزين، وكل تأخير بعده 4 مراكز إضافية.
export const FIRST_LATE_PENALTY = 2;
export const REPEAT_LATE_PENALTY = 4;

/** عدد المراكز التي يتراجعها المريض عند تأخيره رقم lateNumber (1 = أول تأخير في هذا الموعد). */
export function latePenaltyFor(lateNumber: number): number {
  if (lateNumber <= 0) return 0;
  return lateNumber === 1 ? FIRST_LATE_PENALTY : REPEAT_LATE_PENALTY;
}

export interface QueueItem {
  id: string;
  status: AppointmentStatus | string;
  startTime: string;
  skipCredits: number;
}

function byTimeThenId(a: QueueItem, b: QueueItem) {
  return a.startTime === b.startTime ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.startTime < b.startTime ? -1 : 1;
}

const isLate = (a: QueueItem) => a.status === AppointmentStatus.LATE;

/**
 * من يُنادى التالي من بين المنتظرين (CONFIRMED + LATE). null إن كانت القائمة فارغة.
 *  1) متأخر نفد رصيده (مرّ قبله العدد المطلوب من المرضى): دوره الآن مباشرة — كما تقول لوحة الطبيب
 *     أصلًا «دوره التالي مباشرة» — حتى لو كان موعده الأصلي أبعد من موعد غيره.
 *  2) وإلا أول مريض في الانتظار حسب وقت موعده.
 *  3) وإلا (لم يبق إلا متأخرون برصيد) أقلهم رصيدًا.
 */
export function pickNext<T extends QueueItem>(waiting: T[]): T | null {
  if (waiting.length === 0) return null;
  const sorted = [...waiting].sort(byTimeThenId);
  const dueLate = sorted.find((a) => isLate(a) && a.skipCredits <= 0);
  if (dueLate) return dueLate;
  const confirmed = sorted.find((a) => !isLate(a));
  if (confirmed) return confirmed;
  // لم يبق إلا متأخرون لم ينفد رصيدهم: أقلهم رصيدًا (الترتيب الزمني يكسر التعادل).
  return sorted.reduce((best, a) => (a.skipCredits < best.skipCredits ? a : best), sorted[0]);
}

/**
 * الترتيب المتوقع لكل المنتظرين، بمحاكاة المناداة المتتالية بنفس قواعد callNextPatient تمامًا
 * (اختيار pickNext ثم إنقاص رصيد المتأخرين الباقين). لا يعدّل المدخلات.
 */
export function projectQueueOrder<T extends QueueItem>(waiting: T[]): T[] {
  const pool = waiting.map((a) => ({ item: a, credits: a.skipCredits }));
  const order: T[] = [];
  while (pool.length > 0) {
    const view = pool.map((p) => ({ ...p.item, skipCredits: p.credits }));
    const next = pickNext(view)!;
    const idx = pool.findIndex((p) => p.item.id === next.id);
    order.push(pool[idx].item);
    pool.splice(idx, 1);
    for (const p of pool) if (isLate(p.item) && p.credits > 0) p.credits -= 1;
  }
  return order;
}
