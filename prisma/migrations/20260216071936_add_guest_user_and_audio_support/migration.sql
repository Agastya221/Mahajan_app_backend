-- AlterEnum
ALTER TYPE "AttachmentType" ADD VALUE 'CHAT_AUDIO';

-- AlterEnum
ALTER TYPE "ChatMessageType" ADD VALUE 'AUDIO';

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "driverRegistered" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pendingReceiverPhone" TEXT,
ADD COLUMN     "receiverRegistered" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trackingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Trip_pendingReceiverPhone_idx" ON "Trip"("pendingReceiverPhone");
