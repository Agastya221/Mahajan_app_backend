-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChatMessageType" ADD VALUE 'TRIP_CARD';
ALTER TYPE "ChatMessageType" ADD VALUE 'PAYMENT_REQUEST';
ALTER TYPE "ChatMessageType" ADD VALUE 'INVOICE_CARD';
ALTER TYPE "ChatMessageType" ADD VALUE 'DATA_GRID';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "metadata" JSONB;
