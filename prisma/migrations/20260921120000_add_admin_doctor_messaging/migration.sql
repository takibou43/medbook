-- إضافة فقط: جدولان جديدان للمراسلة بين الإدارة والأطباء. لا تعديل ولا حذف في أي جدول موجود.

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

-- CreateIndex
CREATE UNIQUE INDEX "doctor_conversations_doctorId_key" ON "doctor_conversations"("doctorId");

-- CreateIndex
CREATE INDEX "doctor_conversations_lastMessageAt_idx" ON "doctor_conversations"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_messages_conversationId_senderId_clientId_key" ON "doctor_messages"("conversationId", "senderId", "clientId");

-- CreateIndex
CREATE INDEX "doctor_messages_conversationId_createdAt_idx" ON "doctor_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "doctor_messages_senderRole_readAt_idx" ON "doctor_messages"("senderRole", "readAt");

-- AddForeignKey
ALTER TABLE "doctor_conversations" ADD CONSTRAINT "doctor_conversations_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_messages" ADD CONSTRAINT "doctor_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "doctor_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
