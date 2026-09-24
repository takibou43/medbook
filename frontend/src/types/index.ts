export type Role = "PATIENT" | "DOCTOR" | "ADMIN";
export type Gender = "MALE" | "FEMALE";
export type AppointmentStatus = "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "LATE" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

// موعد كما يعيده GET /api/patient/account/appointments (حقول الطبيب الآمنة فقط).
export interface MyAppointment {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  doctor: {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    address?: string | null;
    specialty?: { nameAr: string } | null;
    clinic?: { nameAr: string; address: string; phone?: string | null } | null;
  };
}
export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

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
  id: string;
  nameAr: string;
  address: string;
  phone?: string | null;
}

export interface Doctor {
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
  avgRating: number;
  reviewsCount: number;
  schedules?: DoctorSchedule[];
  reviews?: Review[];
  user?: { email: string; phone?: string | null; isActive?: boolean };
  // إحداثيات موقع العيادة (اختيارية) — لحساب المسافة وفتح الملاحة. distanceKm يُحسب في
  // الخادم فقط عندما يُرسل المريض موقعه (lat/lng) مع طلب البحث.
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number | null;
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
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  // إشعار مرتبط بموعد: ينتهي بنهاية يوم الموعد بتوقيت الجزائر (null = إشعار عام لا ينتهي).
  appointmentId?: string | null;
  appointmentDate?: string | null;
  expiresAt?: string | null;
}

export interface User {
  id: string;
  email: string;
  phone?: string | null;
  role: Role;
  isActive: boolean;
  patient?: { id: string; firstName: string; lastName: string } | null;
  doctor?: Doctor | null;
  // حظر من إنشاء حجوزات جديدة (يُحدّده الخادم؛ الخادم يرفض الحجز على أي حال).
  isBlocked?: boolean;
}

export interface NextSlot {
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
