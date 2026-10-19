import { Prisma } from "@prisma/client";
import { PUBLIC_TERMS_SELECT } from "./clinicFinance";

export const PUBLIC_DOCTOR_SELECT = {
  id: true,
  dutyEndsAt: true,
  firstName: true,
  lastName: true,
  specialtyId: true,
  specialty: { select: { id: true, nameAr: true, nameFr: true, icon: true, description: true } },
  clinic: { select: { id: true, nameAr: true, address: true, phone: true } },
  wilayaId: true,
  wilaya: { select: { id: true, code: true, nameAr: true, nameFr: true } },
  cityId: true,
  city: { select: { id: true, nameAr: true, wilayaId: true } },
  bio: true,
  yearsExperience: true,
  languages: true,
  gender: true,
  phone: true,
  address: true,
  consultationFee: true,
  // سعر العيادة فقط (لا النسبة) — يُدمج في consultationFee ثم يُحذف قبل الاستجابة (withPublicFee).
  clinicTerms: PUBLIC_TERMS_SELECT,
  photoUrl: true,
  latitude: true,
  longitude: true,
  verificationStatus: true,
  avgRating: true,
  reviewsCount: true,
} satisfies Prisma.DoctorSelect;
