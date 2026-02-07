/*
  Warnings:

  - The `messageType` column on the `ChatMessage` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `TypingIndicator` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'IMAGE', 'PDF', 'FILE', 'SYSTEM_MESSAGE', 'PAYMENT_UPDATE', 'INVOICE_UPDATE', 'LOCATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentType" ADD VALUE 'CHAT_IMAGE';
ALTER TYPE "AttachmentType" ADD VALUE 'CHAT_DOCUMENT';

-- DropForeignKey
ALTER TABLE "TypingIndicator" DROP CONSTRAINT "TypingIndicator_threadId_fkey";

-- DropForeignKey
ALTER TABLE "TypingIndicator" DROP CONSTRAINT "TypingIndicator_userId_fkey";

-- AlterTable
ALTER TABLE "ChatMessage" DROP COLUMN "messageType",
ADD COLUMN     "messageType" "ChatMessageType" NOT NULL DEFAULT 'TEXT';

-- DropTable
DROP TABLE "TypingIndicator";
