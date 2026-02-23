/*
  Chat Architecture Migration: Trip-per-thread → Org-pair-per-thread
  
  Before: Each trip had its own ChatThread (tripId on ChatThread)
  After:  One ChatThread per org pair (orgId + counterpartyOrgId), trips appear as message cards

  Data migration strategy:
  1. Add counterpartyOrgId as nullable first
  2. Populate counterpartyOrgId from existing trip/account relations
  3. Move tripId from ChatThread to ChatMessage (trip context on messages)
  4. Make counterpartyOrgId NOT NULL
  5. Add unique constraint on org pair
  6. Clean up duplicate threads (merge messages into one thread per org pair)
*/

-- Step 1: Add counterpartyOrgId as NULLABLE first (can't add NOT NULL to non-empty table)
ALTER TABLE "ChatThread" ADD COLUMN "counterpartyOrgId" TEXT;

-- Step 2: Add tripId to ChatMessage for trip-context messages
ALTER TABLE "ChatMessage" ADD COLUMN "tripId" TEXT;

-- Step 3: Populate counterpartyOrgId from TRIP relations
-- For threads linked to trips, get the destination org
UPDATE "ChatThread" ct
SET "counterpartyOrgId" = t."destinationOrgId"
FROM "Trip" t
WHERE ct."tripId" = t.id
AND ct."counterpartyOrgId" IS NULL
AND ct."orgId" != t."destinationOrgId";

-- Handle case where orgId IS the destination (sender created thread from other side)
UPDATE "ChatThread" ct
SET "counterpartyOrgId" = t."sourceOrgId"
FROM "Trip" t
WHERE ct."tripId" = t.id
AND ct."counterpartyOrgId" IS NULL
AND ct."orgId" = t."destinationOrgId";

-- Step 4: Populate counterpartyOrgId from ACCOUNT relations
UPDATE "ChatThread" ct
SET "counterpartyOrgId" = a."counterpartyOrgId"
FROM "Account" a
WHERE ct."accountId" = a.id
AND ct."counterpartyOrgId" IS NULL
AND ct."orgId" != a."counterpartyOrgId";

-- Handle case where orgId IS the counterparty
UPDATE "ChatThread" ct
SET "counterpartyOrgId" = a."ownerOrgId"
FROM "Account" a
WHERE ct."accountId" = a.id
AND ct."counterpartyOrgId" IS NULL
AND ct."orgId" = a."counterpartyOrgId";

-- Step 5: For any remaining threads without counterpartyOrgId, delete them (orphaned data)
DELETE FROM "ChatMessage" WHERE "threadId" IN (
  SELECT id FROM "ChatThread" WHERE "counterpartyOrgId" IS NULL
);
DELETE FROM "ChatThread" WHERE "counterpartyOrgId" IS NULL;

-- Step 6: Normalize org pair ordering (smaller cuid first)
-- This ensures (A,B) and (B,A) become the same normalized pair
UPDATE "ChatThread"
SET "orgId" = LEAST("orgId", "counterpartyOrgId"),
    "counterpartyOrgId" = GREATEST("orgId", "counterpartyOrgId")
WHERE "orgId" > "counterpartyOrgId";

-- Step 7: Merge duplicate threads (same org pair after normalization)
-- Move messages from duplicate threads to the "winner" (earliest created)
WITH duplicates AS (
  SELECT "orgId", "counterpartyOrgId",
         MIN(id) as keep_id,
         ARRAY_AGG(id) as all_ids
  FROM "ChatThread"
  GROUP BY "orgId", "counterpartyOrgId"
  HAVING COUNT(*) > 1
),
to_delete AS (
  SELECT UNNEST(all_ids) as thread_id, keep_id
  FROM duplicates
)
UPDATE "ChatMessage" cm
SET "threadId" = td.keep_id
FROM to_delete td
WHERE cm."threadId" = td.thread_id
AND td.thread_id != td.keep_id;

-- Delete the duplicate threads (messages already moved)
WITH duplicates AS (
  SELECT "orgId", "counterpartyOrgId",
         MIN(id) as keep_id,
         ARRAY_AGG(id) as all_ids
  FROM "ChatThread"
  GROUP BY "orgId", "counterpartyOrgId"
  HAVING COUNT(*) > 1
),
to_delete AS (
  SELECT UNNEST(all_ids) as thread_id, keep_id
  FROM duplicates
)
DELETE FROM "ChatThread"
WHERE id IN (SELECT thread_id FROM to_delete WHERE thread_id != keep_id);

-- Step 8: Link existing messages to their trips (from the old thread→trip relationship)
-- Before we drop tripId from ChatThread, copy it to the messages
UPDATE "ChatMessage" cm
SET "tripId" = ct."tripId"
FROM "ChatThread" ct
WHERE cm."threadId" = ct.id
AND ct."tripId" IS NOT NULL
AND cm."tripId" IS NULL;

-- Step 9: Now make counterpartyOrgId NOT NULL
ALTER TABLE "ChatThread" ALTER COLUMN "counterpartyOrgId" SET NOT NULL;

-- Step 10: Update default type
ALTER TABLE "ChatThread" ALTER COLUMN "type" SET DEFAULT 'ORG_CHAT';

-- Step 11: Drop old trip relationship from ChatThread
ALTER TABLE "ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_tripId_fkey";
DROP INDEX IF EXISTS "ChatThread_tripId_key";
DROP INDEX IF EXISTS "ChatThread_tripId_updatedAt_idx";
ALTER TABLE "ChatThread" DROP COLUMN IF EXISTS "tripId";

-- Step 12: Create new indexes and constraints
CREATE INDEX IF NOT EXISTS "ChatMessage_tripId_idx" ON "ChatMessage"("tripId");
CREATE INDEX IF NOT EXISTS "ChatThread_counterpartyOrgId_updatedAt_idx" ON "ChatThread"("counterpartyOrgId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ChatThread_counterpartyOrgId_lastMessageAt_idx" ON "ChatThread"("counterpartyOrgId", "lastMessageAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ChatThread_orgId_counterpartyOrgId_key" ON "ChatThread"("orgId", "counterpartyOrgId");

-- Step 13: Add foreign keys
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_counterpartyOrgId_fkey" FOREIGN KEY ("counterpartyOrgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
