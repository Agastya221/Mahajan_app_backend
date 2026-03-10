-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "advanceBalance" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "dueAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "paidAmount" BIGINT NOT NULL DEFAULT 0;
