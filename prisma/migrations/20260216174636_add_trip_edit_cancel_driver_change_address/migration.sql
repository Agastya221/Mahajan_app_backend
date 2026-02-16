-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TripEventType" ADD VALUE 'TRIP_EDITED';
ALTER TYPE "TripEventType" ADD VALUE 'DRIVER_CHANGED';
ALTER TYPE "TripEventType" ADD VALUE 'TRUCK_CHANGED';

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "altPhone" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "destinationAddress" JSONB,
ADD COLUMN     "sourceAddress" JSONB;

-- CreateIndex
CREATE INDEX "Trip_createdByUserId_idx" ON "Trip"("createdByUserId");
