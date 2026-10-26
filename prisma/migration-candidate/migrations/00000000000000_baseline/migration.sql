-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLINIC_OWNER', 'PATIENT', 'DOCTOR', 'ADMIN', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RESCHEDULE_REQUIRED', 'IN_PROGRESS', 'LATE', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('UNPAID', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsultationType" AS ENUM ('IN_PERSON', 'FOLLOW_UP', 'ONLINE');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AppointmentCreatedBy" AS ENUM ('PATIENT', 'DOCTOR', 'ADMIN', 'GUEST');

-- CreateEnum
CREATE TYPE "FamilyRelationship" AS ENUM ('CHILD', 'SPOUSE', 'PARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "TreatmentPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TreatmentSessionStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DentalFollowUpStatus" AS ENUM ('DUE', 'SCHEDULED', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DoctorReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PatientBlockType" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "UrgencyStatus" AS ENUM ('NONE', 'REQUESTED', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('ONE_HOUR', 'FIVE_MINUTES', 'QUEUE_APPROACH');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wilayas" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameFr" TEXT,

    CONSTRAINT "wilayas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "wilayaId" TEXT NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialties" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameFr" TEXT,
    "icon" TEXT,
    "description" TEXT,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_services" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "price" INTEGER,

    CONSTRAINT "medical_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinics" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "wilayaId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "ownerId" TEXT,
    "description" TEXT,
    "photoUrl" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'UNPAID',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "paidDoctorCount" INTEGER NOT NULL DEFAULT 0,
    "referralDiscountUntil" TIMESTAMP(3),
    "pendingReferralDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "gender" "Gender",
    "cityId" TEXT,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_identity_claims" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guest_identity_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_doctor_invites" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "termsPriceDzd" INTEGER,
    "termsDoctorSharePercent" INTEGER,

    CONSTRAINT "clinic_doctor_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_transfer_requests" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "pendingDoctorId" TEXT,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "termsPriceDzd" INTEGER,
    "termsDoctorSharePercent" INTEGER,

    CONSTRAINT "clinic_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_doctor_terms" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentPriceDzd" INTEGER,
    "doctorSharePercent" INTEGER,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_doctor_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "ownerPatientId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "gender" "Gender",
    "relationship" "FamilyRelationship" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_blocks" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "activePatientId" TEXT,
    "reason" TEXT,
    "blockType" "PatientBlockType" NOT NULL DEFAULT 'MANUAL',
    "noShowCount" INTEGER,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedBy" TEXT,
    "unblockedAt" TIMESTAMP(3),
    "unblockedBy" TEXT,

    CONSTRAINT "patient_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_templates" (
    "design" JSONB,
    "doctorId" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "top" INTEGER NOT NULL DEFAULT 40,
    "bottom" INTEGER NOT NULL DEFAULT 30,
    "side" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_templates_pkey" PRIMARY KEY ("doctorId")
);

-- CreateTable
CREATE TABLE "prescription_settings" (
    "doctorId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "professional" JSONB,
    "show" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_settings_pkey" PRIMARY KEY ("doctorId")
);

-- CreateTable
CREATE TABLE "doctors" (
    "dutyEndsAt" TIMESTAMP(3),
    "queueRequestedAt" TIMESTAMP(3),
    "clinicManagerForId" TEXT,
    "clinicPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "clinicId" TEXT,
    "wilayaId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "bio" TEXT,
    "yearsExperience" INTEGER NOT NULL DEFAULT 0,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gender" "Gender",
    "phone" TEXT,
    "address" TEXT,
    "consultationFee" INTEGER,
    "photoUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "slotDurationMin" INTEGER NOT NULL DEFAULT 7,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'UNPAID',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "newDoctorTrial" BOOLEAN NOT NULL DEFAULT false,
    "trialStartedAt" TIMESTAMP(3),
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistants" (
    "shiftEndsAt" TIMESTAMP(3),
    "allDoctors" BOOLEAN NOT NULL DEFAULT true,
    "allowedDoctorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clinicId" TEXT,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_invites" (
    "clinicId" TEXT,
    "allDoctors" BOOLEAN NOT NULL DEFAULT true,
    "allowedDoctorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "assistant_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_documents" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedules" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionDate" TIMESTAMP(3),
    "isOff" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "urgencyStatus" "UrgencyStatus" NOT NULL DEFAULT 'NONE',
    "urgencyReason" TEXT,
    "urgencyRequestedAt" TIMESTAMP(3),
    "urgencyDecidedAt" TIMESTAMP(3),
    "urgencyDecidedBy" TEXT,
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "guestFirstName" TEXT,
    "guestLastName" TEXT,
    "guestPhone" TEXT,
    "doctorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "type" "ConsultationType" NOT NULL DEFAULT 'IN_PERSON',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3),
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "deferredCount" INTEGER NOT NULL DEFAULT 0,
    "skipCredits" INTEGER NOT NULL DEFAULT 0,
    "arrivedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activeSlot" BOOLEAN DEFAULT true,
    "familyMemberId" TEXT,
    "parentAppointmentId" TEXT,
    "treatmentPlanId" TEXT,
    "treatmentSessionId" TEXT,
    "createdBy" "AppointmentCreatedBy" NOT NULL DEFAULT 'PATIENT',
    "createdByUserId" TEXT,
    "idempotencyKey" TEXT,
    "isFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "followUpAnchorId" TEXT,
    "slotSeq" INTEGER NOT NULL DEFAULT 0,
    "doctorFollowUp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_services" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_financials" (
    "appointmentId" TEXT NOT NULL,
    "priceDzd" INTEGER,
    "doctorSharePercent" INTEGER,
    "clinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_financials_pkey" PRIMARY KEY ("appointmentId")
);

-- CreateTable
CREATE TABLE "sms_logs" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL,
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" TEXT,
    "appointmentDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "newDoctorId" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "suggestedSpecialtyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_conversations" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "lastSenderRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "Role" NOT NULL,
    "content" TEXT NOT NULL,
    "clientId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reminders" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_late_events" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "penalty" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_late_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_treatment_plans" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "familyMemberId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TreatmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "estimatedSessions" INTEGER,
    "estimatedTotalCost" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dental_treatment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_treatment_sessions" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "sessionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "plannedDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "TreatmentSessionStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dental_treatment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_follow_ups" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "DentalFollowUpStatus" NOT NULL DEFAULT 'DUE',
    "appointmentId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dental_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_referrals" (
    "id" TEXT NOT NULL,
    "referrerDoctorId" TEXT NOT NULL,
    "referredDoctorId" TEXT NOT NULL,
    "referralCodeUsed" TEXT NOT NULL,
    "status" "DoctorReferralStatus" NOT NULL DEFAULT 'PENDING',
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "rewardDays" INTEGER NOT NULL DEFAULT 30,
    "rewardClinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wilayas_code_key" ON "wilayas"("code");

-- CreateIndex
CREATE INDEX "cities_wilayaId_idx" ON "cities"("wilayaId");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_nameAr_key" ON "specialties"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_ownerId_key" ON "clinics"("ownerId");

-- CreateIndex
CREATE INDEX "clinics_wilayaId_cityId_idx" ON "clinics"("wilayaId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "patients_userId_key" ON "patients"("userId");

-- CreateIndex
CREATE INDEX "patients_cityId_idx" ON "patients"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_identity_claims_patientId_key" ON "guest_identity_claims"("patientId");

-- CreateIndex
CREATE INDEX "guest_identity_claims_phone_lastSentAt_idx" ON "guest_identity_claims"("phone", "lastSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_doctor_invites_tokenHash_key" ON "clinic_doctor_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "clinic_doctor_invites_clinicId_status_idx" ON "clinic_doctor_invites"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_transfer_requests_pendingDoctorId_key" ON "clinic_transfer_requests"("pendingDoctorId");

-- CreateIndex
CREATE INDEX "clinic_transfer_requests_clinicId_status_idx" ON "clinic_transfer_requests"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_doctor_terms_doctorId_key" ON "clinic_doctor_terms"("doctorId");

-- CreateIndex
CREATE INDEX "clinic_doctor_terms_clinicId_idx" ON "clinic_doctor_terms"("clinicId");

-- CreateIndex
CREATE INDEX "family_members_ownerPatientId_idx" ON "family_members"("ownerPatientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_blocks_activePatientId_key" ON "patient_blocks"("activePatientId");

-- CreateIndex
CREATE INDEX "patient_blocks_patientId_idx" ON "patient_blocks"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_userId_key" ON "doctors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_referralCode_key" ON "doctors"("referralCode");

-- CreateIndex
CREATE INDEX "doctors_specialtyId_wilayaId_cityId_idx" ON "doctors"("specialtyId", "wilayaId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "assistants_userId_key" ON "assistants"("userId");

-- CreateIndex
CREATE INDEX "assistants_doctorId_idx" ON "assistants"("doctorId");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_invites_tokenHash_key" ON "assistant_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "assistant_invites_doctorId_idx" ON "assistant_invites"("doctorId");

-- CreateIndex
CREATE INDEX "doctor_schedules_doctorId_idx" ON "doctor_schedules"("doctorId");

-- CreateIndex
CREATE INDEX "appointments_patientId_idx" ON "appointments"("patientId");

-- CreateIndex
CREATE INDEX "appointments_doctorId_date_idx" ON "appointments"("doctorId", "date");

-- CreateIndex
CREATE INDEX "appointments_familyMemberId_idx" ON "appointments"("familyMemberId");

-- CreateIndex
CREATE INDEX "appointments_parentAppointmentId_idx" ON "appointments"("parentAppointmentId");

-- CreateIndex
CREATE INDEX "appointments_createdAt_status_idx" ON "appointments"("createdAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_doctorId_date_startTime_activeSlot_key" ON "appointments"("doctorId", "date", "startTime", "slotSeq", "activeSlot");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_doctorId_idempotencyKey_key" ON "appointments"("doctorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "appointment_financials_clinicId_idx" ON "appointment_financials"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "sms_logs_appointmentId_key" ON "sms_logs"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_appointmentId_key" ON "reviews"("appointmentId");

-- CreateIndex
CREATE INDEX "reviews_doctorId_idx" ON "reviews"("doctorId");

-- CreateIndex
CREATE INDEX "reviews_patientId_idx" ON "reviews"("patientId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_userId_expiresAt_idx" ON "notifications"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "notifications_expiresAt_idx" ON "notifications"("expiresAt");

-- CreateIndex
CREATE INDEX "notifications_appointmentId_idx" ON "notifications"("appointmentId");

-- CreateIndex
CREATE INDEX "notifications_newDoctorId_idx" ON "notifications"("newDoctorId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_type_newDoctorId_key" ON "notifications"("userId", "type", "newDoctorId");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_userId_doctorId_key" ON "favorites"("userId", "doctorId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_conversations_doctorId_key" ON "doctor_conversations"("doctorId");

-- CreateIndex
CREATE INDEX "doctor_conversations_lastMessageAt_idx" ON "doctor_conversations"("lastMessageAt");

-- CreateIndex
CREATE INDEX "doctor_messages_conversationId_createdAt_idx" ON "doctor_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "doctor_messages_senderRole_readAt_idx" ON "doctor_messages"("senderRole", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_messages_conversationId_senderId_clientId_key" ON "doctor_messages"("conversationId", "senderId", "clientId");

-- CreateIndex
CREATE INDEX "appointment_reminders_status_scheduledFor_idx" ON "appointment_reminders"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_reminders_appointmentId_type_key" ON "appointment_reminders"("appointmentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_late_events_appointmentId_sequence_key" ON "appointment_late_events"("appointmentId", "sequence");

-- CreateIndex
CREATE INDEX "dental_treatment_plans_doctorId_idx" ON "dental_treatment_plans"("doctorId");

-- CreateIndex
CREATE INDEX "dental_treatment_plans_patientId_idx" ON "dental_treatment_plans"("patientId");

-- CreateIndex
CREATE INDEX "dental_treatment_plans_familyMemberId_idx" ON "dental_treatment_plans"("familyMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "dental_treatment_sessions_appointmentId_key" ON "dental_treatment_sessions"("appointmentId");

-- CreateIndex
CREATE INDEX "dental_treatment_sessions_treatmentPlanId_idx" ON "dental_treatment_sessions"("treatmentPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "dental_follow_ups_appointmentId_key" ON "dental_follow_ups"("appointmentId");

-- CreateIndex
CREATE INDEX "dental_follow_ups_treatmentPlanId_dueDate_idx" ON "dental_follow_ups"("treatmentPlanId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_referrals_referredDoctorId_key" ON "doctor_referrals"("referredDoctorId");

-- CreateIndex
CREATE INDEX "doctor_referrals_rewardClinicId_idx" ON "doctor_referrals"("rewardClinicId");

-- CreateIndex
CREATE INDEX "doctor_referrals_referrerDoctorId_idx" ON "doctor_referrals"("referrerDoctorId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_wilayaId_fkey" FOREIGN KEY ("wilayaId") REFERENCES "wilayas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_wilayaId_fkey" FOREIGN KEY ("wilayaId") REFERENCES "wilayas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_identity_claims" ADD CONSTRAINT "guest_identity_claims_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_doctor_invites" ADD CONSTRAINT "clinic_doctor_invites_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_transfer_requests" ADD CONSTRAINT "clinic_transfer_requests_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_transfer_requests" ADD CONSTRAINT "clinic_transfer_requests_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_ownerPatientId_fkey" FOREIGN KEY ("ownerPatientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_blocks" ADD CONSTRAINT "patient_blocks_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_settings" ADD CONSTRAINT "prescription_settings_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_wilayaId_fkey" FOREIGN KEY ("wilayaId") REFERENCES "wilayas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_invites" ADD CONSTRAINT "assistant_invites_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_documents" ADD CONSTRAINT "doctor_documents_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_parentAppointmentId_fkey" FOREIGN KEY ("parentAppointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "dental_treatment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_treatmentSessionId_fkey" FOREIGN KEY ("treatmentSessionId") REFERENCES "dental_treatment_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "medical_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_financials" ADD CONSTRAINT "appointment_financials_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_newDoctorId_fkey" FOREIGN KEY ("newDoctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_conversations" ADD CONSTRAINT "doctor_conversations_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_messages" ADD CONSTRAINT "doctor_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "doctor_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_late_events" ADD CONSTRAINT "appointment_late_events_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_sessions" ADD CONSTRAINT "dental_treatment_sessions_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "dental_treatment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_sessions" ADD CONSTRAINT "dental_treatment_sessions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_follow_ups" ADD CONSTRAINT "dental_follow_ups_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "dental_treatment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_follow_ups" ADD CONSTRAINT "dental_follow_ups_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_referrerDoctorId_fkey" FOREIGN KEY ("referrerDoctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_referredDoctorId_fkey" FOREIGN KEY ("referredDoctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_rewardClinicId_fkey" FOREIGN KEY ("rewardClinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

