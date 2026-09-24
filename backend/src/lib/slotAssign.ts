import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { generateAvailableSlots, isPast, ScheduleBlock } from "./slots";
import { SLOT_OCCUPYING_WHERE } from "./slotOccupancy";
import { lockDoctorQueue, withDoctorQueueTurn } from "./doctorLock";

/**
 * حجز «الوقت المطلوب أو أقرب وقت متاح بعده» لدى طبيب في يوم معيّن — للحجز بوقت محدد
 * (POST /api/booking مع date+startTime، و POST /api/appointments).
 *
 * لماذا؟ عندما يطلب عدة مرضى نفس الوقت في نفس اللحظة، يأخذه واحد فقط، وكان الباقون يُرفضون بـ409.
 * الآن كل واحد منهم يحصل تلقائيًا على أول وقت صالح وشاغر بعد الوقت الذي طلبه، في نفس اليوم.
 *
 * الأولوية (موثّقة ومختبرة): ليست ترتيب وصول طلبات HTTP، بل ترتيب حصول معاملة كل طلب على قفل طابور
 * الطبيب داخل قاعدة البيانات (pg_advisory_xact_lock) — من يُثبِّت معاملته (commit) أولًا يأخذ الوقت
 * المطلوب، ومن بعده يأخذ أول وقت شاغر بعده، وهكذا.
 *
 * طبقات الحماية من التكرار (كلها باقية):
 *  1) قفل استشاري لكل طبيب داخل المعاملة: القراءة («ما المشغول؟») والإدراج ذرّيان بالنسبة لأي حجز آخر
 *     عند نفس الطبيب يمر بهذا المسار أو بمسار الحجز الآلي (نفس مفتاح القفل).
 *  2) القيد الفريد (doctorId, date, startTime, activeSlot) في قاعدة البيانات: خط الدفاع الأخير.
 *  3) إن ظهر P2002 رغم ذلك (كاتب لا يستعمل القفل، مثل إدراج مباشر في القاعدة) لا نُرجع 409: نعيد حساب
 *     أول وقت شاغر بعد الوقت المطلوب ونحاول مجددًا، بحد أقصى MAX_SLOT_ATTEMPTS محاولة (لا حلقة لا نهائية).
 *
 * القواعد المستعملة هي نفسها في كل MadBook: مدة الموعد = مدة جلسة الطبيب (slotDurationMin، وإلا 20)،
 * الفترات من generateAvailableSlots (أوقات العمل، والاستراحات = الفجوات بين فترات العمل، واستثناءات الأيام)،
 * والوقت المشغول = كل موعد غير CANCELLED (SLOT_OCCUPYING_WHERE؛ COMPLETED/NO_SHOW تشغل وقتها، والملغى يحرّره).
 * لا ننتقل أبدًا إلى يوم آخر، ولا نتجاوز نهاية دوام الطبيب، ولا نعطي وقتًا مضى.
 */

export const DEFAULT_SLOT_MINUTES = 20;
export const MAX_SLOT_ATTEMPTS = 10;
// أقصى انتظار في طابور الطبيب داخل العملية قبل الرفض بـ503 (نفس قيمة الحجز الآلي).
const QUEUE_TURN_MAX_WAIT_MS = 30_000;

export interface SlotDoctor {
  id: string;
  slotDurationMin: number;
  schedules: ScheduleBlock[];
}

export interface AssignedSlot {
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

/** لا يوجد أي وقت صالح وشاغر في ذلك اليوم عند/بعد الوقت المطلوب. */
export class NoSlotAvailableError extends Error {
  constructor() {
    super("no slot available on that day at or after the requested time");
    Object.setPrototypeOf(this, NoSlotAvailableError.prototype);
  }
}

/** استنفدنا محاولات إعادة الحساب بعد تعارضات P2002 متتالية (حالة شاذة جدًا). */
export class SlotRaceExhaustedError extends Error {
  constructor() {
    super("slot race retries exhausted");
    Object.setPrototypeOf(this, SlotRaceExhaustedError.prototype);
  }
}

export function slotMinutesFor(doctor: Pick<SlotDoctor, "slotDurationMin">): number {
  return doctor.slotDurationMin > 0 ? doctor.slotDurationMin : DEFAULT_SLOT_MINUTES;
}

export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * دالة نقية: أول وقت صالح وشاغر عند/بعد الوقت المطلوب، في نفس اليوم فقط.
 * booked = الفترات المشغولة (كل موعد غير ملغى)، exclude = أوقات فشلت للتو بـP2002 في هذا الطلب.
 */
export function firstFreeSlotAtOrAfter(
  date: Date,
  schedules: ScheduleBlock[],
  booked: { startTime: string; endTime: string }[],
  slotMinutes: number,
  requestedStart: string,
  exclude: ReadonlySet<string> = new Set(),
  isPastFn: (date: Date, hhmm: string) => boolean = isPast
): string | null {
  const from = toMinutes(requestedStart);
  const slots = generateAvailableSlots(date, schedules, booked, slotMinutes);
  return slots.find((s) => toMinutes(s) >= from && !exclude.has(s) && !isPastFn(date, s)) ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// عدّاد تشخيصي داخل العملية (للاختبارات والسجلات): كم مرة أُعيد الحساب بعد P2002 حقيقي.
export const slotAssignStats = { p2002Retries: 0 };

/**
 * يحجز الوقت المطلوب أو أقرب وقت شاغر بعده. create(tx, slot) ينشئ الموعد داخل نفس المعاملة (تحت القفل).
 * يرمي NoSlotAvailableError إن لم يبقَ وقت في ذلك اليوم، و SlotRaceExhaustedError بعد MAX_SLOT_ATTEMPTS.
 */
export async function reserveRequestedOrNextSlot<T>(opts: {
  doctor: SlotDoctor;
  date: Date;
  requestedStart: string;
  create: (tx: Prisma.TransactionClient, slot: AssignedSlot) => Promise<T>;
}): Promise<{ result: T; slot: AssignedSlot; shifted: boolean; attempts: number }> {
  const { doctor, date, requestedStart, create } = opts;
  const slotMinutes = slotMinutesFor(doctor);
  const failed = new Set<string>();
  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  for (let attempt = 1; attempt <= MAX_SLOT_ATTEMPTS; attempt++) {
    // حامل بدل متغير محلي: القيمة تُضبط داخل دالة المعاملة (TypeScript لا يتتبّع ذلك في التضييق).
    const pick: { value: string | null } = { value: null };
    try {
      const result = await withDoctorQueueTurn(doctor.id, QUEUE_TURN_MAX_WAIT_MS, () =>
        prisma.$transaction(
          async (tx) => {
            await lockDoctorQueue(tx, doctor.id);
            const booked = await tx.appointment.findMany({
              where: { doctorId: doctor.id, date: { gte: startOfDay, lte: endOfDay }, ...SLOT_OCCUPYING_WHERE },
              select: { startTime: true, endTime: true },
            });
            const chosen = firstFreeSlotAtOrAfter(date, doctor.schedules, booked, slotMinutes, requestedStart, failed);
            if (!chosen) throw new NoSlotAvailableError();
            pick.value = chosen;
            return create(tx, { startTime: chosen, endTime: addMinutes(chosen, slotMinutes), slotMinutes });
          },
          // الطلبات المتزامنة لنفس الطبيب تنتظر القفل بالدور (نفس مهلة الحجز الآلي).
          { maxWait: 20000, timeout: 30000 }
        )
      );
      const startTime = pick.value as string;
      const slot = { startTime, endTime: addMinutes(startTime, slotMinutes), slotMinutes };
      return { result, slot, shifted: startTime !== requestedStart, attempts: attempt };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // سباق حقيقي على الوقت الذي اخترناه (كاتب خارج القفل): نستبعده ونعيد الحساب من جديد.
      slotAssignStats.p2002Retries += 1;
      if (pick.value) failed.add(pick.value);
    }
  }
  throw new SlotRaceExhaustedError();
}

/** الوقت الذي اختاره المريض بنفسه لم يعد متاحًا (حُجز، أو خارج الدوام/الشبكة، أو مضى). */
export class ExactSlotUnavailableError extends Error {
  constructor() {
    super("the exact requested slot is not available");
    Object.setPrototypeOf(this, ExactSlotUnavailableError.prototype);
  }
}

/**
 * حجز «الوقت الذي اختاره المريض بالضبط» — للاختيار الاختياري لليوم والوقت في واجهة الحجز.
 * بخلاف reserveRequestedOrNextSlot لا ينقل المريض إلى وقت آخر: إن لم يعد الوقت متاحًا يرمي
 * ExactSlotUnavailableError فيعرض له العميل «هذا الموعد لم يعد متاحًا» ويحدّث الأوقات.
 *
 * نفس طبقات الحماية تمامًا: قفل طابور الطبيب (قراءة المشغول + الإدراج ذرّيان)، والقيد الفريد
 * (doctorId, date, startTime, activeSlot) خط دفاع أخير — P2002 هنا يعني أن مريضًا آخر أخذه → غير متاح.
 * «متاح» = ضمن generateAvailableSlots (أوقات العمل + الاستثناءات + مدة الجلسة + غير مشغول بموعد غير ملغى)
 * ولم يمضِ وقته — نفس ما تعرضه واجهة الأوقات (getDoctorDaySlots).
 */
export async function reserveExactSlot<T>(opts: {
  doctor: SlotDoctor;
  date: Date;
  startTime: string;
  create: (tx: Prisma.TransactionClient, slot: AssignedSlot) => Promise<T>;
}): Promise<{ result: T; slot: AssignedSlot }> {
  const { doctor, date, startTime, create } = opts;
  const slotMinutes = slotMinutesFor(doctor);
  const slot = { startTime, endTime: addMinutes(startTime, slotMinutes), slotMinutes };
  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  try {
    const result = await withDoctorQueueTurn(doctor.id, QUEUE_TURN_MAX_WAIT_MS, () =>
      prisma.$transaction(
        async (tx) => {
          await lockDoctorQueue(tx, doctor.id);
          const booked = await tx.appointment.findMany({
            where: { doctorId: doctor.id, date: { gte: startOfDay, lte: endOfDay }, ...SLOT_OCCUPYING_WHERE },
            select: { startTime: true, endTime: true },
          });
          const free = generateAvailableSlots(date, doctor.schedules, booked, slotMinutes);
          if (!free.includes(startTime) || isPast(date, startTime)) throw new ExactSlotUnavailableError();
          return create(tx, slot);
        },
        { maxWait: 20000, timeout: 30000 }
      )
    );
    return { result, slot };
  } catch (err) {
    if (isUniqueViolation(err)) throw new ExactSlotUnavailableError();
    throw err;
  }
}
