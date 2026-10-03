import { z } from "zod";
import { AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * الأسعار والنسب داخل العيادات.
 *
 * - الشروط تخص علاقة (طبيب، عيادة) في جدول ClinicDoctorTerms ولا تلمس Doctor.consultationFee.
 * - نسبة العيادة = 100 − نسبة الطبيب، تُحسب دائمًا ولا يُدخلها أحد ولا تُخزَّن.
 * - اللقطة المالية تُنشأ مع الموعد (AppointmentFinancial) ولا يعدّلها أي مسار.
 * - هذه النسبة تخص إيراد الموعد، وهي منفصلة تمامًا عن اشتراك الطبيب أو رسوم مادبوك.
 * - لا دفع ولا تحويل هنا: حساب وعرض فقط.
 */

export const MAX_APPOINTMENT_PRICE_DZD = 10_000_000;

/** يقبل تعديل السعر أو النسبة أو كليهما؛ نسبة العيادة مرفوضة لأنها تُحسب تلقائيًا (strict). */
export const clinicDoctorTermsSchema = z
  .object({
    appointmentPriceDzd: z.number().int().min(0).max(MAX_APPOINTMENT_PRICE_DZD).optional(),
    doctorSharePercent: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine(v => v.appointmentPriceDzd !== undefined || v.doctorSharePercent !== undefined, { message: "لا يوجد تغيير." });

/** نفس الحقلين اختياريين عند دعوة طبيب (يضبطهما المدير مسبقًا أو يتركهما). */
export const inviteTermsFields = {
  appointmentPriceDzd: z.number().int().min(0).max(MAX_APPOINTMENT_PRICE_DZD).optional(),
  doctorSharePercent: z.number().int().min(0).max(100).optional(),
};

export type ClinicDoctorTermsInput = z.infer<typeof clinicDoctorTermsSchema>;

/** حصة الطبيب بالدينار مقرَّبة لأقرب دينار؛ الباقي للعيادة فيبقى المجموع = السعر تمامًا. */
export function splitAppointment(priceDzd: number, doctorSharePercent: number) {
  const doctorDzd = Math.floor((priceDzd * doctorSharePercent + 50) / 100);
  return { doctorDzd, clinicDzd: priceDzd - doctorDzd };
}

export const clinicSharePercent = (doctorSharePercent: number) => 100 - doctorSharePercent;

type TermsRow = { clinicId: string; appointmentPriceDzd: number | null; doctorSharePercent: number | null };

export type FinanceSource = {
  clinicId: string | null;
  consultationFee: number | null;
  clinicTerms: TermsRow | null;
};

/** شروط سارية فقط إن كان الطبيب ما زال في العيادة نفسها التي سُجّلت فيها الشروط. */
function activeTerms(source: FinanceSource) {
  const t = source.clinicTerms;
  return source.clinicId && t && t.clinicId === source.clinicId ? t : null;
}

/** السعر الفعلي للموعد: سعر العيادة إن وُجد، وإلا سعر الطبيب consultationFee كما كان. */
export function effectiveAppointmentPrice(source: FinanceSource): number | null {
  return activeTerms(source)?.appointmentPriceDzd ?? source.consultationFee ?? null;
}

/** ما يُحفظ مع الموعد لحظة إنشائه. النسبة NULL لطبيب مستقل أو لنسبة لم تُحدَّد بعد. */
export function financialSnapshot(source: FinanceSource) {
  const t = activeTerms(source);
  return {
    priceDzd: effectiveAppointmentPrice(source),
    doctorSharePercent: t?.doctorSharePercent ?? null,
    clinicId: source.clinicId ?? null,
  };
}

export const FINANCE_SOURCE_SELECT = {
  clinicId: true,
  consultationFee: true,
  clinicTerms: { select: { clinicId: true, appointmentPriceDzd: true, doctorSharePercent: true } },
} satisfies Prisma.DoctorSelect;

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * يُحمَّل قبل قفل طابور الطبيب (استعلام واحد بالمفتاح الأساسي) ثم يُمرَّر إلى create.
 * يعيد كائن `financial` جاهزًا للإنشاء المتداخل داخل appointment.create، فيُحفظ في المعاملة نفسها.
 * عمدًا لا نضيف clinicTerms إلى كائن الطبيب المحمَّل للحجز، لأنه يعود في استجابة المريض.
 */
export async function loadFinancialCreate(doctorId: string, db: Db = prisma) {
  const doctor = await db.doctor.findUnique({ where: { id: doctorId }, select: FINANCE_SOURCE_SELECT });
  return { create: financialSnapshot(doctor ?? { clinicId: null, consultationFee: null, clinicTerms: null }) };
}

/** السعر الذي يراه المريض: سعر العيادة إن وُجد. لا نسب ولا حقول مالية أخرى. */
export function withPublicFee<T extends { consultationFee?: number | null; clinicTerms?: unknown }>(doctor: T) {
  const { clinicTerms, ...rest } = doctor as T & { clinicTerms?: { appointmentPriceDzd: number | null } | null };
  const price = clinicTerms?.appointmentPriceDzd;
  return { ...rest, consultationFee: price ?? rest.consultationFee ?? null } as Omit<T, "clinicTerms">;
}

/**
 * اتساق السعر عند المريض: سعر الموعد الجديد هو السعر المحفوظ في لقطته (لا يتغير بعد تعديل سعر الطبيب)،
 * وللموعد السابق للميزة (بلا لقطة) السعر الفعلي الحالي. يُوضع في `priceDzd` وفي `doctor.consultationFee`
 * معًا حتى لا يرى المريض رقمين مختلفين. لا نسبة ولا أي حقل مالي آخر.
 */
export function applyAppointmentPrice<T extends object>(appt: T, priceDzd: number | null) {
  const src = appt as T & { doctor?: object | null; financial?: unknown };
  const { financial: _financial, ...rest } = src;
  const out: Record<string, unknown> = { ...rest, priceDzd };
  if (src.doctor) {
    const { clinicTerms: _terms, ...doctor } = src.doctor as Record<string, unknown>;
    out.doctor = { ...doctor, consultationFee: priceDzd };
  }
  return out as Omit<T, "financial"> & { priceDzd: number | null };
}

/** لصفوف قُرئت مع `financial: {priceDzd}` و`doctor.clinicTerms: {appointmentPriceDzd}` (قراءات متعددة بلا N+1). */
export function withAppointmentPrice<
  T extends {
    financial?: { priceDzd: number | null } | null;
    doctor?: { consultationFee?: number | null; clinicTerms?: { appointmentPriceDzd: number | null } | null } | null;
  },
>(appt: T) {
  const snapshot = appt.financial;
  const price = snapshot ? snapshot.priceDzd : (appt.doctor ? withPublicFee(appt.doctor).consultationFee ?? null : null);
  return applyAppointmentPrice(appt, price);
}

/** سعر موعد واحد لمسارات القراءة الفردية: اللقطة إن وُجدت، وإلا السعر الفعلي الحالي للطبيب. */
export async function patientPriceFor(appointmentId: string, doctorId: string, db: Db = prisma): Promise<number | null> {
  const snap = await db.appointmentFinancial.findUnique({ where: { appointmentId }, select: { priceDzd: true } });
  if (snap) return snap.priceDzd;
  const doctor = await db.doctor.findUnique({ where: { id: doctorId }, select: FINANCE_SOURCE_SELECT });
  return doctor ? effectiveAppointmentPrice(doctor) : null;
}

export const PUBLIC_TERMS_SELECT = { select: { appointmentPriceDzd: true } } as const;

/* ---------------- التقارير ---------------- */

export type FinanceRow = { status: AppointmentStatus; priceDzd: number | null; doctorSharePercent: number | null };

export type FinanceSummary = {
  completedCount: number;
  /** مجموع أسعار المواعيد المكتملة التي لها سعر محفوظ. */
  grossDzd: number;
  /** مستحقات الطبيب: المكتملة ذات النسبة المحفوظة فقط. */
  doctorDuesDzd: number;
  clinicShareDzd: number;
  /** مكتملة بلا نسبة (طبيب مستقل، نسبة غير محددة وقتها، أو موعد سابق للميزة): تظهر عددًا ولا تدخل المستحقات. */
  completedWithoutShare: number;
  /** الملغاة ولم يحضر والمعلّقة: عدد فقط، لا مبلغ ولا مستحقات. */
  cancelledCount: number;
  noShowCount: number;
  pendingCount: number;
};

const PENDING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.LATE,
  AppointmentStatus.RESCHEDULE_REQUIRED,
];

/**
 * قاعدة الاستحقاق (بمنطق المشروع الحالي، الذي لا يعرف «دفعًا» للموعد): المستحقات تُحسب للمواعيد COMPLETED وحدها.
 * CANCELLED وNO_SHOW وبقية الحالات غير المنتهية تُعرض عددًا فقط وتبقى خارج كل مبلغ.
 */
export function summarizeFinance(rows: FinanceRow[]): FinanceSummary {
  const s: FinanceSummary = {
    completedCount: 0, grossDzd: 0, doctorDuesDzd: 0, clinicShareDzd: 0,
    completedWithoutShare: 0, cancelledCount: 0, noShowCount: 0, pendingCount: 0,
  };
  for (const r of rows) {
    if (r.status === AppointmentStatus.CANCELLED) s.cancelledCount++;
    else if (r.status === AppointmentStatus.NO_SHOW) s.noShowCount++;
    else if (PENDING_STATUSES.includes(r.status)) s.pendingCount++;
    else if (r.status === AppointmentStatus.COMPLETED) {
      s.completedCount++;
      if (r.priceDzd != null) s.grossDzd += r.priceDzd;
      if (r.priceDzd != null && r.doctorSharePercent != null) {
        const { doctorDzd, clinicDzd } = splitAppointment(r.priceDzd, r.doctorSharePercent);
        s.doctorDuesDzd += doctorDzd;
        s.clinicShareDzd += clinicDzd;
      } else s.completedWithoutShare++;
    }
  }
  return s;
}

export type FinanceGroup = { priceDzd: number | null; doctorSharePercent: number | null; count: number };

/**
 * يجمع مواعيد مكتملة مجمّعة بحسب (السعر، النسبة) المحفوظين. المواعيد السابقة للميزة (بلا لقطة) تُسعَّر بالسعر الحالي
 * كما كان "الدخل التقديري" يعمل قبلها، ولا يُنسب لها استحقاق. ما له سعر ونسبة معًا يدخل المستحقات بالتقريب لكل موعد.
 */
export function revenueFromGroups(groups: FinanceGroup[], legacyCount: number, legacyPriceDzd: number | null) {
  let grossDzd = 0;
  let doctorDuesDzd = 0;
  let clinicShareDzd = 0;
  let withoutShare = Math.max(0, legacyCount);
  for (const g of groups) {
    if (g.priceDzd != null) grossDzd += g.priceDzd * g.count;
    if (g.priceDzd != null && g.doctorSharePercent != null) {
      const { doctorDzd, clinicDzd } = splitAppointment(g.priceDzd, g.doctorSharePercent);
      doctorDuesDzd += doctorDzd * g.count;
      clinicShareDzd += clinicDzd * g.count;
    } else withoutShare += g.count;
  }
  grossDzd += Math.max(0, legacyCount) * (legacyPriceDzd ?? 0);
  return { grossDzd, doctorDuesDzd, clinicShareDzd, completedWithoutShare: withoutShare };
}
