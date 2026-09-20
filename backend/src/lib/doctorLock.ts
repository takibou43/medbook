import { Prisma } from "@prisma/client";

/**
 * قفل استشاري (advisory lock) على مستوى المعاملة لطابور طبيب واحد.
 *
 * يُستدعى أول شيء داخل prisma.$transaction: كل طلب حجز تلقائي لنفس الطبيب ينتظر دوره هنا،
 * فيقرأ "أول دور شاغر" ويكتبه دون أن يسبقه طلب آخر بين القراءة والكتابة. أطباء مختلفون لا
 * يتعطّلون بعضهم ببعض (مفتاح القفل خاص بكل طبيب). يُحرَّر القفل تلقائيًا عند commit/rollback،
 * ولا يعتمد على أي جدول أو عمود جديد، ويعمل مع اتصالات Neon/pgbouncer لأنه داخل معاملة واحدة.
 * قيد التفرّد @@unique([doctorId, date, startTime]) يبقى خط الدفاع الأخير.
 */
export async function lockDoctorQueue(tx: Prisma.TransactionClient, doctorId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"doctor-queue:" + doctorId}, 0))`;
}

/**
 * قفل استشاري منفصل لعمليات المناداة في الطابور (التالي / مريض بعينه) عند طبيب واحد.
 * مفتاح مستقل عن قفل الحجز حتى لا تنتظر المناداة خلف طابور حجوزات طويل؛ المناداة تقرأ
 * "هل هناك مريض بالداخل؟" ثم تكتب IN_PROGRESS، فبلا قفل يستطيع طلبان متزامنان إدخال مريضين معًا.
 */
export async function lockDoctorCalls(tx: Prisma.TransactionClient, doctorId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"doctor-calls:" + doctorId}, 0))`;
}

/**
 * طابور انتظار داخل العملية (in-process) لكل طبيب، يُوضع *قبل* فتح معاملة قاعدة البيانات.
 *
 * المشكلة التي يعالجها (مقيسة): كل حجز يفتح معاملة ثم ينتظر القفل الاستشاري وهو يحتجز اتصالًا
 * من مجمّع Prisma. عند تدفّق طلبات على طبيب واحد يمتلئ المجمّع بمنتظرين على القفل فتجوع بقية
 * الاستعلامات (P2024 ← خطأ 500). هنا ينتظر الطلب في الذاكرة (بلا اتصال) ولا يفتح المعاملة إلا
 * عند دوره، فيبقى اتصالان فقط لكل طبيب (انظر PER_DOCTOR_CONCURRENCY). القفل الاستشاري داخل المعاملة
 * يبقى كما هو (يحمي عند تعدّد نسخ الخادم)، وقيد التفرّد يبقى خط الدفاع الأخير.
 *
 * حدّ الانتظار: إن تجاوز الطلب maxWaitMs في الطابور يُرفض بـ503 *قبل* أي كتابة، فلا يُنشأ لاحقًا
 * حجز "يتيم" بعد أن يكون العميل قد انقطع (ما يدفع المريض لإعادة المحاولة وتكرار الحجز).
 */
// عدد المعاملات المسموح بها معًا لكل طبيب: واحدة تكتب، وأخرى جاهزة على القفل الاستشاري. وجود الثانية
// يجعل تسليم القفل فوريًا داخل قاعدة البيانات (دون انتظار BEGIN + طلب القفل بعد commit السابقة)، فلا
// يتأخر الطابور، ومع ذلك يحتجز الطبيب الواحد اتصالين فقط من المجمّع مهما بلغ عدد المنتظرين.
const PER_DOCTOR_CONCURRENCY = 2;

interface Gate {
  active: number;
  waiters: Array<() => void>;
}
const gates = new Map<string, Gate>();

export class DoctorQueueBusyError extends Error {
  constructor() {
    super("doctor queue wait exceeded");
    Object.setPrototypeOf(this, DoctorQueueBusyError.prototype);
  }
}

export async function withDoctorQueueTurn<T>(doctorId: string, maxWaitMs: number, fn: () => Promise<T>): Promise<T> {
  let gate = gates.get(doctorId);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    gates.set(doctorId, gate);
  }
  const g = gate;

  if (g.active < PER_DOCTOR_CONCURRENCY) {
    g.active++;
  } else {
    // ننتظر في الذاكرة (بلا اتصال بقاعدة البيانات) حتى يحين الدور أو ينتهي حدّ الانتظار.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = g.waiters.indexOf(wake);
        if (i >= 0) g.waiters.splice(i, 1);
        if (g.active === 0 && g.waiters.length === 0 && gates.get(doctorId) === g) gates.delete(doctorId);
        reject(new DoctorQueueBusyError());
      }, maxWaitMs);
      // عند الاستدعاء تكون الخانة قد حُجزت لنا من المُحرِّر (active لم يُنقَص).
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      g.waiters.push(wake);
    });
  }

  try {
    return await fn();
  } finally {
    const next = g.waiters.shift();
    if (next) next(); // نمرّر الخانة مباشرة للمنتظر التالي
    else {
      g.active--;
      if (g.active === 0 && gates.get(doctorId) === g) gates.delete(doctorId);
    }
  }
}
