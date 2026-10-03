import { AppointmentStatus } from "@prisma/client";
import { beneficiaryOf, type Beneficiary } from "./beneficiary";
import { ALGERIA_OFFSET_MINUTES } from "./slots";

/**
 * «مرضاي» للطبيب: تجميع المواعيد إلى مرضى + بحث + فرز + تقسيم صفحات.
 * دوال نقية (بلا قاعدة بيانات ولا Date.now داخلية) — تُختبر بوقت ثابت.
 *
 * التعريفات (مصدرها حالات AppointmentStatus الموجودة، بلا حالات جديدة):
 *  - «آخر زيارة مكتملة» = أحدث موعد حالته COMPLETED فقط. (سابقًا كان أحدث موعد بأي حالة،
 *    فكانت تظهر تواريخ مستقبلية ومواعيد ملغاة كـ«آخر زيارة».)
 *  - «الموعد القادم» = أقرب موعد حالته PENDING أو CONFIRMED أو LATE ويقع يوم اليوم (بتوقيت الجزائر)
 *    أو بعده. موعد اليوم المفتوح يبقى «قادمًا» حتى بعد وقته لأنه ما زال في طابور اليوم إلى أن
 *    يُحسم أو يُغلَق اليوم تلقائيًا (autoExpireStaleAppointments).
 */
export const UPCOMING_PATIENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.LATE,
];

export interface PatientAppointmentRow {
  id: string;
  date: Date;
  startTime: string;
  status: AppointmentStatus;
  patientId: string | null;
  familyMemberId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestPhone: string | null;
  patient: { firstName: string; lastName: string; user: { email: string | null; phone: string | null } } | null;
  familyMember: { id: string; firstName: string; lastName: string; relationship: any } | null;
}

export interface VisitRef {
  appointmentId: string;
  /** YYYY-MM-DD (التاريخ التقويمي للموعد). */
  date: string;
  startTime: string;
  status: AppointmentStatus;
}

export interface PatientSummary {
  key: string;
  patientId: string | null;
  familyMemberId: string | null;
  isGuest: boolean;
  firstName: string | null;
  lastName: string | null;
  beneficiary: Beneficiary;
  accountHolderName: string | null;
  email: string | null;
  phone: string | null;
  totalAppointments: number;
  lastCompletedVisit: VisitRef | null;
  nextAppointment: VisitRef | null;
  /** للتوافق مع الواجهة القديمة: = تاريخ آخر زيارة مكتملة (أو null). */
  lastVisit: string | null;
  lastAppointmentId: string | null;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const sortKey = (v: VisitRef) => `${v.date}T${v.startTime}`;

export function algeriaTodayKey(nowMs: number): string {
  return new Date(nowMs + ALGERIA_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

/** هوية المستفيد المسجلة فقط. حجز الضيف سجل مستقل غير مثبت الهوية؛ لا دمج بالهاتف. */
export function patientKey(a: Pick<PatientAppointmentRow, "id" | "patientId" | "familyMemberId" | "guestPhone">): string {
  return a.patientId ? `${a.patientId}:${a.familyMemberId ?? "self"}` : `guest-booking:${a.id}`;
}

export function summarizePatients(rows: PatientAppointmentRow[], nowMs: number): PatientSummary[] {
  const today = algeriaTodayKey(nowMs);
  const map = new Map<string, PatientSummary>();
  const order: string[] = [];
  for (const a of rows) {
    const key = patientKey(a);
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        patientId: a.patientId,
        familyMemberId: a.familyMemberId,
        isGuest: !a.patientId,
        firstName: a.familyMember ? a.familyMember.firstName : a.patient ? a.patient.firstName : a.guestFirstName,
        lastName: a.familyMember ? a.familyMember.lastName : a.patient ? a.patient.lastName : a.guestLastName,
        beneficiary: beneficiaryOf(a),
        accountHolderName: a.familyMember && a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : null,
        email: a.patient ? a.patient.user.email : null,
        phone: a.patient?.user.phone ?? a.guestPhone,
        totalAppointments: 0,
        lastCompletedVisit: null,
        nextAppointment: null,
        lastVisit: null,
        lastAppointmentId: null,
      };
      map.set(key, row);
      order.push(key);
    }
    row.totalAppointments += 1;
    const ref: VisitRef = { appointmentId: a.id, date: dayKey(a.date), startTime: a.startTime, status: a.status };
    if (a.status === AppointmentStatus.COMPLETED && (!row.lastCompletedVisit || sortKey(ref) > sortKey(row.lastCompletedVisit))) {
      row.lastCompletedVisit = ref;
    }
    if (UPCOMING_PATIENT_STATUSES.includes(a.status) && ref.date >= today && (!row.nextAppointment || sortKey(ref) < sortKey(row.nextAppointment))) {
      row.nextAppointment = ref;
    }
    // مرجع «برمجة موعد عودة»: أحدث موعد غير ملغى لمريض صاحب حساب (القاعدة القديمة نفسها؛
    // الصفوف تصل مرتبة تنازليًا بالتاريخ والوقت، فأول صف مؤهل هو الأحدث).
    if (!row.lastAppointmentId && a.patientId && a.status !== AppointmentStatus.CANCELLED) row.lastAppointmentId = a.id;
  }
  return order.map((k) => {
    const r = map.get(k)!;
    r.lastVisit = r.lastCompletedVisit?.date ?? null;
    return r;
  });
}

export type PatientSort = "recent" | "next" | "name";

export interface PatientQuery {
  q?: string;
  sort?: PatientSort;
  page?: number;
  pageSize?: number;
}

export interface PatientPage {
  items: PatientSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const PATIENTS_DEFAULT_PAGE_SIZE = 25;
export const PATIENTS_MAX_PAGE_SIZE = 100;

const normalizeAr = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

export function matchesPatient(p: PatientSummary, q: string): boolean {
  const query = q.trim();
  if (!query) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 3 && (p.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
  const haystack = normalizeAr([p.firstName, p.lastName, p.beneficiary.name, p.accountHolderName, p.email].filter(Boolean).join(" "));
  return haystack.includes(normalizeAr(query));
}

function compare(a: PatientSummary, b: PatientSummary, sort: PatientSort): number {
  const name = (p: PatientSummary) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  if (sort === "name") return name(a).localeCompare(name(b), "ar");
  if (sort === "next") {
    const ka = a.nextAppointment ? sortKey(a.nextAppointment) : null;
    const kb = b.nextAppointment ? sortKey(b.nextAppointment) : null;
    if (ka && kb) return ka < kb ? -1 : ka > kb ? 1 : 0;
    if (ka) return -1;
    if (kb) return 1;
    return name(a).localeCompare(name(b), "ar");
  }
  // recent: آخر زيارة مكتملة الأحدث أولًا؛ من لا زيارة مكتملة له في الأسفل.
  const ka = a.lastCompletedVisit ? sortKey(a.lastCompletedVisit) : null;
  const kb = b.lastCompletedVisit ? sortKey(b.lastCompletedVisit) : null;
  if (ka && kb) return ka > kb ? -1 : ka < kb ? 1 : 0;
  if (ka) return -1;
  if (kb) return 1;
  return 0;
}

export function queryPatients(all: PatientSummary[], query: PatientQuery): PatientPage {
  const sort: PatientSort = query.sort === "name" || query.sort === "next" ? query.sort : "recent";
  const pageSize = Math.min(PATIENTS_MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? PATIENTS_DEFAULT_PAGE_SIZE)));
  const filtered = all.filter((p) => matchesPatient(p, query.q ?? ""));
  // فرز مستقر: يحافظ على الترتيب الأصلي عند التساوي.
  const sorted = filtered.map((p, i) => ({ p, i })).sort((x, y) => compare(x.p, y.p, sort) || x.i - y.i).map((x) => x.p);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(query.page ?? 1)));
  return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
}
