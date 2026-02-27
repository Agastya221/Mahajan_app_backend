/*
  Warnings:

  - You are about to drop the column `title` on the `ChatThread` table. All the data in the column will be lost.
  - You are about to drop the column `unreadCount` on the `ChatThread` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "isDeletedForEveryone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ChatThread" DROP COLUMN "title",
DROP COLUMN "unreadCount";

-- CreateTable
CREATE TABLE "ChatMessageDeletion" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessageDeletion_userId_idx" ON "ChatMessageDeletion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageDeletion_messageId_userId_key" ON "ChatMessageDeletion"("messageId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_isDeletedForEveryone_idx" ON "ChatMessage"("threadId", "isDeletedForEveryone");

-- AddForeignKey
ALTER TABLE "ChatMessageDeletion" ADD CONSTRAINT "ChatMessageDeletion_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
