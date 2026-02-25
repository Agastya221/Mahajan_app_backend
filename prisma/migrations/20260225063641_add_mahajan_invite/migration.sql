-- CreateTable
CREATE TABLE "MahajanInvite" (
    "id" TEXT NOT NULL,
    "invitedByOrgId" TEXT NOT NULL,
    "invitedPhone" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "inviteeOrgId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MahajanInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MahajanInvite_inviteToken_key" ON "MahajanInvite"("inviteToken");

-- CreateIndex
CREATE INDEX "MahajanInvite_invitedPhone_idx" ON "MahajanInvite"("invitedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "MahajanInvite_invitedByOrgId_invitedPhone_key" ON "MahajanInvite"("invitedByOrgId", "invitedPhone");

-- AddForeignKey
ALTER TABLE "MahajanInvite" ADD CONSTRAINT "MahajanInvite_invitedByOrgId_fkey" FOREIGN KEY ("invitedByOrgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
