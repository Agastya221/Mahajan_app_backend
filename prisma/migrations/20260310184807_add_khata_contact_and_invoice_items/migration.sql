-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemNameHindi" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(10,2),
    "amount" BIGINT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhataContact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhataContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhataEntry" (
    "id" TEXT NOT NULL,
    "khataContactId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance" BIGINT NOT NULL,
    "description" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "transactionType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KhataEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhataPayment" (
    "id" TEXT NOT NULL,
    "khataContactId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "mode" TEXT,
    "tag" "PaymentTag",
    "remarks" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KhataPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "KhataContact_orgId_idx" ON "KhataContact"("orgId");

-- CreateIndex
CREATE INDEX "KhataContact_orgId_phone_idx" ON "KhataContact"("orgId", "phone");

-- CreateIndex
CREATE INDEX "KhataEntry_khataContactId_createdAt_idx" ON "KhataEntry"("khataContactId", "createdAt");

-- CreateIndex
CREATE INDEX "KhataPayment_khataContactId_createdAt_idx" ON "KhataPayment"("khataContactId", "createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhataContact" ADD CONSTRAINT "KhataContact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhataEntry" ADD CONSTRAINT "KhataEntry_khataContactId_fkey" FOREIGN KEY ("khataContactId") REFERENCES "KhataContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhataPayment" ADD CONSTRAINT "KhataPayment_khataContactId_fkey" FOREIGN KEY ("khataContactId") REFERENCES "KhataContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhataPayment" ADD CONSTRAINT "KhataPayment_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
