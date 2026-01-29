-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MAHAJAN_OWNER', 'MAHAJAN_STAFF', 'DRIVER');

-- CreateEnum
CREATE TYPE "OrgMemberRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "MahajanRoleType" AS ENUM ('SOURCE_COLLECTOR', 'DESTINATION_DISTRIBUTOR', 'BOTH');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('CREATED', 'ASSIGNED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'REACHED', 'DELIVERED', 'COMPLETED', 'CLOSED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TripEventType" AS ENUM ('TRIP_CREATED', 'ASSIGNED', 'LOAD_COMPLETED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'TRIP_COMPLETED', 'POD_UPLOADED', 'PAYMENT_RECORDED', 'DISPUTE_RAISED', 'DISPUTE_RESOLVED', 'TRIP_CANCELLED', 'CLOSED', 'NOTE');

-- CreateEnum
CREATE TYPE "QuantityUnit" AS ENUM ('KG', 'BAG', 'TON', 'CRATE', 'BOX', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentTag" AS ENUM ('ADVANCE', 'PARTIAL', 'FINAL', 'DUE', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('LOAD_PHOTO', 'RECEIVE_PHOTO', 'INVOICE', 'RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('PAYABLE', 'RECEIVABLE');

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "gstin" TEXT,
    "roleType" "MahajanRoleType" NOT NULL DEFAULT 'BOTH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "suspendedAt" TIMESTAMP(3),
    "bannedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgMember" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgMemberRole" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "licenseNo" TEXT,
    "emergencyPhone" TEXT,
    "notes" TEXT,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT,
    "capacity" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "sourceOrgId" TEXT NOT NULL,
    "destinationOrgId" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "driverId" TEXT,
    "startPoint" TEXT,
    "endPoint" TEXT,
    "startTime" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "estimatedDistance" DOUBLE PRECISION,
    "estimatedArrival" TIMESTAMP(3),
    "notes" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripLoadCard" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "QuantityUnit" NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "createdByUserId" TEXT,

    CONSTRAINT "TripLoadCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripReceiveCard" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "QuantityUnit" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shortage" DECIMAL(12,3),
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "disputeReason" TEXT,
    "createdByUserId" TEXT,

    CONSTRAINT "TripReceiveCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripEvent" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "eventType" "TripEventType" NOT NULL,
    "description" TEXT,
    "metaJson" JSONB,
    "atTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripLocation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "driverId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "batchId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripLatestLocation" (
    "tripId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripLatestLocation_pkey" PRIMARY KEY ("tripId")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "ownerOrgId" TEXT NOT NULL,
    "counterpartyOrgId" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tripId" TEXT,
    "direction" "LedgerDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance" BIGINT NOT NULL,
    "description" TEXT,
    "note" TEXT,
    "tag" "PaymentTag",
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tripId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "total" BIGINT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "invoiceId" TEXT,
    "tripId" TEXT,
    "amount" BIGINT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT,
    "reference" TEXT,
    "tag" "PaymentTag",
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT,
    "tripId" TEXT,
    "title" TEXT,
    "type" TEXT NOT NULL DEFAULT 'GENERAL',
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TypingIndicator" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isTyping" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TypingIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "content" TEXT,
    "messageType" TEXT NOT NULL DEFAULT 'TEXT',
    "tag" "PaymentTag",
    "paymentId" TEXT,
    "invoiceId" TEXT,
    "ledgerEntryId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "isDelivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "replyToId" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL DEFAULT 'OTHER',
    "url" TEXT NOT NULL,
    "s3Key" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadCardId" TEXT,
    "receiveCardId" TEXT,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "messageId" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Org_gstin_key" ON "Org"("gstin");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "OrgMember_userId_idx" ON "OrgMember"("userId");

-- CreateIndex
CREATE INDEX "OrgMember_orgId_role_idx" ON "OrgMember"("orgId", "role");

-- CreateIndex
CREATE INDEX "OrgMember_userId_role_idx" ON "OrgMember"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMember_orgId_userId_key" ON "OrgMember"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_deviceId_key" ON "DriverProfile"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_orgId_number_key" ON "Truck"("orgId", "number");

-- CreateIndex
CREATE INDEX "Trip_sourceOrgId_status_createdAt_idx" ON "Trip"("sourceOrgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_destinationOrgId_status_createdAt_idx" ON "Trip"("destinationOrgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_truckId_createdAt_idx" ON "Trip"("truckId", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_driverId_createdAt_idx" ON "Trip"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_driverId_status_idx" ON "Trip"("driverId", "status");

-- CreateIndex
CREATE INDEX "Trip_truckId_status_idx" ON "Trip"("truckId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TripLoadCard_tripId_key" ON "TripLoadCard"("tripId");

-- CreateIndex
CREATE INDEX "TripLoadCard_loadedAt_idx" ON "TripLoadCard"("loadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripReceiveCard_tripId_key" ON "TripReceiveCard"("tripId");

-- CreateIndex
CREATE INDEX "TripReceiveCard_receivedAt_idx" ON "TripReceiveCard"("receivedAt");

-- CreateIndex
CREATE INDEX "TripReceiveCard_status_idx" ON "TripReceiveCard"("status");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_atTime_idx" ON "TripEvent"("tripId", "atTime");

-- CreateIndex
CREATE INDEX "TripEvent_eventType_atTime_idx" ON "TripEvent"("eventType", "atTime");

-- CreateIndex
CREATE INDEX "TripLocation_tripId_capturedAt_idx" ON "TripLocation"("tripId", "capturedAt");

-- CreateIndex
CREATE INDEX "TripLocation_driverId_capturedAt_idx" ON "TripLocation"("driverId", "capturedAt");

-- CreateIndex
CREATE INDEX "TripLocation_batchId_idx" ON "TripLocation"("batchId");

-- CreateIndex
CREATE INDEX "Account_ownerOrgId_idx" ON "Account"("ownerOrgId");

-- CreateIndex
CREATE INDEX "Account_counterpartyOrgId_idx" ON "Account"("counterpartyOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_ownerOrgId_counterpartyOrgId_key" ON "Account"("ownerOrgId", "counterpartyOrgId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_tripId_idx" ON "LedgerEntry"("tripId");

-- CreateIndex
CREATE INDEX "Invoice_accountId_status_idx" ON "Invoice"("accountId", "status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_accountId_invoiceNumber_key" ON "Invoice"("accountId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Payment_accountId_paidAt_idx" ON "Payment"("accountId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_paidAt_idx" ON "Payment"("invoiceId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_tripId_paidAt_idx" ON "Payment"("tripId", "paidAt");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ChatThread_orgId_updatedAt_idx" ON "ChatThread"("orgId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatThread_orgId_lastMessageAt_idx" ON "ChatThread"("orgId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatThread_orgId_isPinned_lastMessageAt_idx" ON "ChatThread"("orgId", "isPinned", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatThread_accountId_updatedAt_idx" ON "ChatThread"("accountId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatThread_tripId_updatedAt_idx" ON "ChatThread"("tripId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatThread_accountId_key" ON "ChatThread"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatThread_tripId_key" ON "ChatThread"("tripId");

-- CreateIndex
CREATE INDEX "TypingIndicator_threadId_isTyping_updatedAt_idx" ON "TypingIndicator"("threadId", "isTyping", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TypingIndicator_threadId_userId_key" ON "TypingIndicator"("threadId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_paymentId_idx" ON "ChatMessage"("paymentId");

-- CreateIndex
CREATE INDEX "ChatMessage_invoiceId_idx" ON "ChatMessage"("invoiceId");

-- CreateIndex
CREATE INDEX "ChatMessage_senderUserId_createdAt_idx" ON "ChatMessage"("senderUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_isRead_senderUserId_idx" ON "ChatMessage"("threadId", "isRead", "senderUserId");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_senderUserId_isRead_idx" ON "ChatMessage"("threadId", "senderUserId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_s3Key_key" ON "Attachment"("s3Key");

-- CreateIndex
CREATE INDEX "Attachment_type_createdAt_idx" ON "Attachment"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_status_idx" ON "Attachment"("status");

-- CreateIndex
CREATE INDEX "Attachment_invoiceId_idx" ON "Attachment"("invoiceId");

-- CreateIndex
CREATE INDEX "Attachment_paymentId_idx" ON "Attachment"("paymentId");

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_destinationOrgId_fkey" FOREIGN KEY ("destinationOrgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLoadCard" ADD CONSTRAINT "TripLoadCard_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLoadCard" ADD CONSTRAINT "TripLoadCard_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripReceiveCard" ADD CONSTRAINT "TripReceiveCard_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripReceiveCard" ADD CONSTRAINT "TripReceiveCard_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripReceiveCard" ADD CONSTRAINT "TripReceiveCard_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLocation" ADD CONSTRAINT "TripLocation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLocation" ADD CONSTRAINT "TripLocation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLatestLocation" ADD CONSTRAINT "TripLatestLocation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerOrgId_fkey" FOREIGN KEY ("ownerOrgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_counterpartyOrgId_fkey" FOREIGN KEY ("counterpartyOrgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypingIndicator" ADD CONSTRAINT "TypingIndicator_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypingIndicator" ADD CONSTRAINT "TypingIndicator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_loadCardId_fkey" FOREIGN KEY ("loadCardId") REFERENCES "TripLoadCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_receiveCardId_fkey" FOREIGN KEY ("receiveCardId") REFERENCES "TripReceiveCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
