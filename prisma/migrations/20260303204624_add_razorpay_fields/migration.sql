/*
  Warnings:

  - A unique constraint covering the columns `[razorpayOrderId]` on the table `DriverPayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[razorpayPaymentId]` on the table `DriverPayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[razorpayOrderId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[razorpayPaymentId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "DriverPayment" ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT,
ADD COLUMN     "razorpaySignature" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DriverPayment_razorpayOrderId_key" ON "DriverPayment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverPayment_razorpayPaymentId_key" ON "DriverPayment"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");
