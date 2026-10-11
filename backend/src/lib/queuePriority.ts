/**
 * دالة الترتيب المركزية لطابور اليوم — المصدر الوحيد لترتيب المنتظرين، يستعملها:
 *   - عرض الطابور للطبيب والمساعد (getQueueForDoctor)،
 *   - المناداة (callNextPatient / callSpecificPatient عبر firstPresent)،
 *   - حساب دور المريض وصفحة «حالة دوري» (locateInQueue في doctorQueue.ts)،
 *   - تنبيهات «دورك اقترب» (تحسب موقعها من locateInQueue نفسها).
 * دالة نقية بلا قاعدة بيانات ولا اعتماد على @prisma/client، فتُختبر مباشرة.
 *
 * الترتيب الأساسي (كما كان): الحاضر (arrivedAt) أولًا، ثم الطوارئ المعتمدة (urgencyStatus = APPROVED)،
 * ثم وقت الموعد HH:mm، ثم المعرّف. الوقت لا يتغير أبدًا، ولا تُستعمل ثوانٍ.
 *
 * أولوية موعد العودة الطبي (isFollowUp): تقديم في الترتيب فقط، لا في وقت الحجز، وبقيود فعلية:
 *  - تُمنح فقط لموعد عودة حاضر (arrivedAt) بحالة CONFIRMED لم يُسجَّل متأخرًا (deferredCount = 0 و skipCredits = 0)،
 *    فلا تُلغي الأولوية عقوبة التأخير ولا تتجاوز حالة LATE.
 *  - لا يتجاوز موعد العودة «مريضًا محميًا»:
 *      · المريض التالي مباشرة لحظة حضور موعد العودة وكل من كان محميًا حينها — تُحفظ عند الحضور كمرساة
 *        (followUpAnchorId = آخر محمي، أو FOLLOW_UP_ANCHOR_NONE إن لم يوجد). حفظها ضروري: لو حُسبت «التالي مباشرة»
 *        ديناميكيًا لتراجع موعد العودة خطوة مع كل مناداة ولم يُنادَ أبدًا؛ فبعد مناداة صاحب المرساة يصير هو التالي.
 *        سجل حاضر بلا مرساة محفوظة (قديم) يُحمى له التالي مباشرة ديناميكيًا احتياطًا.
 *      · من أُرسل له تنبيه «دورك اقترب» فعلًا (nearTurnNotified، من سجل محفوظ لا من افتراض وصول أو قراءة)، في كل لحظة،
 *      · الطوارئ المعتمدة، في كل لحظة،
 *    والمريض الجاري فحصه (IN_PROGRESS) خارج قائمة المنتظرين أصلًا فلا يُزاحَم.
 *  - يُدرج في أول موضع مؤهل = بعد آخر محمي، ولا يُدفع أبدًا إلى ما بعد موضعه الطبيعي بوقت موعده.
 *  - غير المحميين فقط يتأخرون بمركز واحد لكل موعد عودة؛ ترتيب المحميين وبقية الحاضرين فيما بينهم لا يتغير.
 *  - عدة مواعيد عودة: بترتيب حضورها (كل واحد بعد مرساته، والمرساة قد تكون موعد عودة سبقه).
 * الدالة حتمية بالكامل (لا عشوائية ولا اعتماد على ترتيب الطلبات).
 */

export interface QueueOrderRow {
  id: string;
  startTime: string;
  status?: string;
  arrivedAt?: Date | string | null;
  urgencyStatus?: string;
  /** موعد عودة طبي برمجه الطبيب (عمود Appointment.isFollowUp). */
  isFollowUp?: boolean;
  /** عدد مرات التأجيل «متأخر» لهذا الموعد وعدد المراكز المتبقية من عقوبته. */
  deferredCount?: number;
  skipCredits?: number;
  /** أُرسل (أو يُرسل الآن) تنبيه «دورك اقترب» لهذا الموعد حسب سجل AppointmentReminder المحفوظ. */
  nearTurnNotified?: boolean;
  /** مرساة الحماية المحفوظة لحظة حضور موعد العودة (عمود Appointment.followUpAnchorId). */
  followUpAnchorId?: string | null;
}

/** مرساة محفوظة تعني: لم يكن هناك أي محمي لحظة الحضور (يختلف عن null = لم تُحفظ مرساة). */
export const FOLLOW_UP_ANCHOR_NONE = "none";

const isPresent = (r: QueueOrderRow) => Boolean(r.arrivedAt);
const isUrgent = (r: QueueOrderRow) => r.urgencyStatus === "APPROVED";

function baseCompare(a: QueueOrderRow, b: QueueOrderRow): number {
  return (
    Number(isPresent(b)) - Number(isPresent(a)) ||
    Number(isUrgent(b)) - Number(isUrgent(a)) ||
    a.startTime.localeCompare(b.startTime) ||
    a.id.localeCompare(b.id)
  );
}

/** هل يستحق هذا الموعد أولوية موعد العودة الآن؟ */
export function isPriorityFollowUp(r: QueueOrderRow): boolean {
  return (
    r.isFollowUp === true &&
    isPresent(r) &&
    (r.status === undefined || r.status === "CONFIRMED") &&
    !((r.deferredCount ?? 0) > 0) &&
    !((r.skipCredits ?? 0) > 0)
  );
}

export function orderQueue<T extends QueueOrderRow>(rows: T[]): T[] {
  const base = [...rows].sort(baseCompare);
  const priority = base.filter(isPriorityFollowUp);
  if (priority.length === 0) return base;

  const prioritySet = new Set<T>(priority);
  const out = base.filter((r) => !prioritySet.has(r));

  // كل موعد عودة بعد مرساته: نعالج من مرساته ليست موعد عودة معلّقًا أولًا (المرساة قد تكون موعد عودة سبقه).
  const inserted = new Set<T>();
  const pending = [...priority];
  while (pending.length > 0) {
    const pendingIds = new Set(pending.map((p) => p.id));
    const at = pending.findIndex((p) => !p.followUpAnchorId || !pendingIds.has(p.followUpAnchorId));
    const [f] = pending.splice(at >= 0 ? at : 0, 1);
    const anchored = Boolean(f.followUpAnchorId);
    let boundary = -1;
    out.forEach((r, i) => {
      if (!isPresent(r)) return;
      // موعد عودة سبقه في المعالجة (حضر قبله أو مرساته) لا يتجاوزه موعد عودة لاحق.
      if (r.nearTurnNotified === true || isUrgent(r) || inserted.has(r)) boundary = i;
      else if (anchored && r.id === f.followUpAnchorId) boundary = i;
    });
    // سجل حاضر بلا مرساة محفوظة: احتياط محافظ — يُحمى التالي مباشرة (أول حاضر).
    if (!anchored && out.length > 0 && isPresent(out[0])) boundary = Math.max(boundary, 0);
    const natural = out.filter((r) => baseCompare(r, f) < 0).length;
    out.splice(Math.min(natural, boundary + 1), 0, f);
    inserted.add(f);
  }
  return out;
}

/**
 * المرساة التي تُحفظ لحظة حضور موعد العودة: آخر مريض محمي بين الحاضرين الآخرين في الترتيب الحالي
 * (التالي مباشرة، ومن نُبِّه، والطوارئ المعتمدة)، أو FOLLOW_UP_ANCHOR_NONE إن لم يكن أحد حاضرًا.
 */
export function followUpAnchorFor<T extends QueueOrderRow>(rows: T[], selfId: string): string {
  const others = rows.filter((r) => r.id !== selfId && isPresent(r) && (r.status === undefined || r.status === "CONFIRMED" || r.status === "LATE"));
  const ordered = orderQueue(others);
  let last = -1;
  ordered.forEach((r, i) => {
    if (i === 0 || r.nearTurnNotified === true || isUrgent(r)) last = i;
  });
  return last >= 0 ? ordered[last].id : FOLLOW_UP_ANCHOR_NONE;
}
