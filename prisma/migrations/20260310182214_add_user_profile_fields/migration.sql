-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('TRIP', 'INVOICE', 'PAYMENT', 'ADVANCE', 'ADVANCE_APPLIED', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "AttachmentType" ADD VALUE 'PROFILE_PHOTO';

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "transactionType" "LedgerTransactionType";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" VARCHAR(200),
ADD COLUMN     "photoS3Key" TEXT,
ADD COLUMN     "photoUrl" TEXT;
