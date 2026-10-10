CREATE TYPE "UrgencyStatus" AS ENUM ('NONE', 'REQUESTED', 'APPROVED', 'DECLINED');
ALTER TABLE "appointments" ADD COLUMN "urgencyStatus" "UrgencyStatus" NOT NULL DEFAULT 'NONE', ADD COLUMN "urgencyReason" TEXT, ADD COLUMN "urgencyRequestedAt" TIMESTAMP(3), ADD COLUMN "urgencyDecidedAt" TIMESTAMP(3), ADD COLUMN "urgencyDecidedBy" TEXT;
