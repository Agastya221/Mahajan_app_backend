/*
  Warnings:

  - A unique constraint covering the columns `[threadId,clientMessageId]` on the table `ChatMessage` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "clientMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_threadId_clientMessageId_key" ON "ChatMessage"("threadId", "clientMessageId");
