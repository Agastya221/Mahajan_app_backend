-- AlterTable
ALTER TABLE "ChatThread" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedByOrgId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_messageId_type_idx" ON "Attachment"("messageId", "type");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_messageType_isDeletedForEveryone_creat_idx" ON "ChatMessage"("threadId", "messageType", "isDeletedForEveryone", "createdAt");
