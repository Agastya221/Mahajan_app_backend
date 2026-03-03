/*
  Warnings:

  - You are about to alter the column `totalAmount` on the `DriverPayment` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `BigInt`.
  - You are about to alter the column `splitSourceAmount` on the `DriverPayment` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `BigInt`.
  - You are about to alter the column `splitDestAmount` on the `DriverPayment` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `BigInt`.
  - You are about to alter the column `paidAmount` on the `DriverPayment` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `BigInt`.
  - A unique constraint covering the columns `[phone]` on the table `Org` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `expiresAt` to the `MahajanInvite` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `MahajanInvite` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DriverPayment" ALTER COLUMN "totalAmount" SET DATA TYPE BIGINT,
ALTER COLUMN "splitSourceAmount" SET DATA TYPE BIGINT,
ALTER COLUMN "splitDestAmount" SET DATA TYPE BIGINT,
ALTER COLUMN "paidAmount" SET DEFAULT 0,
ALTER COLUMN "paidAmount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "MahajanInvite" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "MahajanInvite_expiresAt_idx" ON "MahajanInvite"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Org_phone_key" ON "Org"("phone");
