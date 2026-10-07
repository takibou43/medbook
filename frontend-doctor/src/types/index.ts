export type Role = "PATIENT" | "DOCTOR" | "ADMIN" | "ASSISTANT" | "CLINIC_OWNER";
export type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export type Gender = "MALE" | "FEMALE";
// IN_PROGRESS = المريض الجالس الآن أمام الطبيب، LATE = نودي عليه فلم يستجب وينتظر عودة دوره.
export type AppointmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "RESCHEDULE_REQUIRED"
  | "IN_PROGRESS"
  | "LATE"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";
export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";
export type SubscriptionStatus = "UNPAID" | "ACTIVE" | "EXPIRED";

export interface Specialty {
  id: string;
  nameAr: string;
  nameFr?: string | null;
  icon?: string | null;
  description?: string | null;
}

export interface City {
  id: string;
  nameAr: string;
  wilayaId: string;
}

export interface Wilaya {
  id: string;
  code: string;
  nameAr: string;
  nameFr?: string | null;
  cities?: City[];
}

export interface Clinic {
  ownerId?: string | null;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionExpiresAt?: string | null;
  id: string;
  nameAr: string;
  address: string;
  phone?: string | null;
}

export interface Doctor {
  clinicManagerForId?: string | null;
  clinicPermissions?: string[];
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  specialtyId: string;
  specialty: Specialty;
  clinic?: Clinic | null;
  wilaya: Wilaya;
  city: City;
  bio?: string | null;
  yearsExperience: number;
  languages: string[];
  gender?: Gender | null;
  phone?: string | null;
  address?: string | null;
  consultationFee?: number | null;
  photoUrl?: string | null;
  verificationStatus: VerificationStatus;
  subscriptionStatus?: SubscriptionStatus;
  // تاريخ انتهاء الاشتراك (أو التجربة المجانية) — نعرض منه عدّ الأيام المتبقية للطبيب.
  subscriptionExpiresAt?: string | null;
  avgRating: number;
  reviewsCount: number;
  schedules?: DoctorSchedule[];
  reviews?: Review[];
  user?: { email: string; phone?: string | null; isActive?: boolean };
  latitude?: number | null;
  longitude?: number | null;
}

export interface DoctorSchedule {
  id: string;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  isException: boolean;
  exceptionDate?: string | null;
  isOff: boolean;
}

export interface Review {
  id: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  patient?: { firstName: string; lastName: string };
  doctor?: { firstName: string; lastName: string };
}

export interface Appointment {
  id: string;
  doctorId: string;
  patientId?: string | null;
  // حجز ضيف بدون حساب: تُملأ هذه الحقول بدل patient عندما patientId فارغ
  guestFirstName?: string | null;
  guestLastName?: string | null;
  guestPhone?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  type: "IN_PERSON" | "FOLLOW_UP" | "ONLINE";
  status: AppointmentStatus;
  notes?: string | null;
  doctor?: Doctor;
  patient?: { firstName: string; lastName: string; user?: { email: string; phone?: string } } | null;
  review?: Review | null;
  // حقول طابور العيادة اليومي
  calledAt?: string | null;
  callCount?: number;
  deferredCount?: number;
  skipCredits?: number;
  arrivedAt?: string | null;
  endedAt?: string | null;
  durationMinutes?: number | null;
  // يُرسله الخادم مع قائمة مواعيد الطبيب: عدد مرات غياب هذا المريض سابقًا
  patientNoShowCount?: number;
  // الحساب العائلي: المستفيد (الاسم وصلة القرابة فقط) — familyMemberId فارغ = صاحب الحساب.
  familyMemberId?: string | null;
  familyMember?: { id: string; firstName: string; lastName: string; relationship: FamilyRelationship } | null;
  beneficiary?: Beneficiary;
  // موعد عودة برمجه الطبيب.
  createdBy?: "PATIENT" | "DOCTOR" | "ADMIN" | "GUEST";
  parentAppointmentId?: string | null;
}

export type FamilyRelationship = "CHILD" | "SPOUSE" | "PARENT" | "SIBLING" | "OTHER";

export interface Beneficiary {
  type: "SELF" | "FAMILY_MEMBER";
  name: string;
  relationship: FamilyRelationship | null;
  familyMemberId: string | null;
}

export type TreatmentPlanStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";
export type TreatmentSessionStatus = "PLANNED" | "COMPLETED" | "CANCELLED";
export type DentalFollowUpStatus = "DUE" | "SCHEDULED" | "COMPLETED" | "DISMISSED";

export interface TreatmentAppointmentRef {
  id: string;
  date: string;
  startTime: string;
  status: AppointmentStatus;
}

export interface TreatmentSession {
  id: string;
  sessionNumber: number;
  title: string;
  notes?: string | null;
  plannedDate?: string | null;
  completedAt?: string | null;
  status: TreatmentSessionStatus;
  appointmentId?: string | null;
  appointment?: TreatmentAppointmentRef | null;
}

export interface DentalFollowUp {
  id: string;
  dueDate: string;
  status: DentalFollowUpStatus;
  completedAt?: string | null;
  appointmentId?: string | null;
  appointment?: TreatmentAppointmentRef | null;
}

export interface TreatmentPlanSummary {
  id: string;
  title: string;
  status: TreatmentPlanStatus;
  estimatedSessions?: number | null;
  estimatedTotalCost?: number | null;
  startedAt: string;
  completedAt?: string | null;
  patientId: string;
  familyMemberId?: string | null;
  beneficiary: Beneficiary;
  sessionsCount: number;
  completedSessions: number;
  nextFollowUp: { id: string; dueDate: string; status: DentalFollowUpStatus } | null;
}

export interface TreatmentPlanDetail {
  id: string;
  title: string;
  description?: string | null;
  status: TreatmentPlanStatus;
  estimatedSessions?: number | null;
  estimatedTotalCost?: number | null;
  startedAt: string;
  completedAt?: string | null;
  patientId: string;
  familyMemberId?: string | null;
  patient: { id: string; firstName: string; lastName: string };
  beneficiary: Beneficiary;
  /** آخر موعد غير ملغى لنفس المستفيد عندك — مرجع «برمجة موعد عودة» من الخطة. */
  anchorAppointmentId: string | null;
  sessions: TreatmentSession[];
  followUps: DentalFollowUp[];
}

export interface PlanCandidate {
  id: string;
  firstName: string;
  lastName: string;
  familyMembers: { id: string; firstName: string; lastName: string; relationship: FamilyRelationship }[];
}

export type DoctorReferralStatus = "PENDING" | "QUALIFIED" | "REWARDED" | "REJECTED";

export interface MyReferrals {
  code: string;
  rewardDays: number;
  referrals: { id: string; status: DoctorReferralStatus; createdAt: string; qualifiedAt?: string | null; rewardedAt?: string | null; rewardDays: number; rewardClinicId?: string | null; referredName: string }[];
  totals: { pending: number; rewarded: number; rewardedDays: number; clinicDiscountDays?: number };
}

export interface AdminReferral {
  id: string;
  status: DoctorReferralStatus;
  referralCodeUsed: string;
  rewardDays: number;
  createdAt: string;
  qualifiedAt?: string | null;
  rewardedAt?: string | null;
  referrer: { id: string; firstName: string; lastName: string; subscriptionStatus: string; subscriptionExpiresAt?: string | null };
  referred: { id: string; firstName: string; lastName: string; verificationStatus: VerificationStatus };
}

/**
 * نسخة الطبيب المختصرة التي تصل ضمن جلسة المساعد (user.assistant.doctor). مطابقة تمامًا
 * لحقول ASSISTANT_SAFE_SELECT في الخادم (backend/src/lib/assistantView.ts) — لا تحتوي
 * consultationFee ولا subscriptionStatus ولا subscriptionExpiresAt عمدًا، فلا تُضِف هذه
 * الحقول هنا إلا إذا أُضيفت فعلًا إلى select في الخادم أولًا.
 */
export interface AssistantDoctorSummary {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  verificationStatus: VerificationStatus;
  specialty: { nameAr: string };
  wilaya: { nameAr: string };
  city: { nameAr: string };
  clinic?: { nameAr: string; address: string } | null;
}

/** بيانات جلسة المساعد نفسها ضمن user.assistant (وليس سجلّ إدارة المساعدين في لوحة الطبيب). */
export interface AssistantSession {
  id: string;
  isActive: boolean;
  doctor: AssistantDoctorSummary;
}

/** سجل مساعد كما يظهر في قائمة "إدارة المساعدين" لدى الطبيب (GET /doctor/assistants). */
export interface AssistantAccount {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  createdAt: string;
  user: { email: string; isActive: boolean; createdAt: string };
}

/** دعوة مساعد كما تظهر في نفس القائمة. */
export interface AssistantInviteItem {
  id: string;
  email: string;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/** ملخص ملفات الحساب (مريض/طبيب) كما يحدده الخادم. الواجهة تعرضه فقط؛ الصلاحيات الفعلية في الخادم. */
export interface AccountProfiles {
  patient: boolean;
  doctor: { status: VerificationStatus } | null;
  canAddPatientProfile: boolean;
  canApplyAsDoctor: boolean;
}

export interface User {
  profiles?: AccountProfiles;
  /** ملف المريض (إن وُجد) — للاسم الافتراضي في نموذج طلب الطبيب. */
  patient?: { id: string; firstName: string; lastName: string } | null;
  ownedClinic?: Clinic | null;
  id: string;
  email: string;
  phone?: string | null;
  role: Role;
  isActive: boolean;
  doctor?: Doctor | null;
  assistant?: AssistantSession | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

