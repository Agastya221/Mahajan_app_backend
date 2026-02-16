# Guest User System — Architecture & Integration Design

> **Goal:** Allow Mahajans to create trips even when the driver and/or receiver (destination Mahajan) has **not yet registered**. Trips are always created. Live features are conditionally enabled. Phone number acts as the identity placeholder. When the person later registers, all past trips auto-link.

---

## Table of Contents

1. [Core Concept](#1-core-concept)
2. [What Already Exists (Your Head Start)](#2-what-already-exists)
3. [Data Model Changes](#3-data-model-changes)
4. [Trip Creation Decision Logic](#4-trip-creation-decision-logic)
5. [Registration Linking Logic](#5-registration-linking-logic)
6. [Feature Behavior Rules](#6-feature-behavior-rules)
7. [Edge Cases](#7-edge-cases)
8. [Scaling Considerations](#8-scaling-considerations)
9. [Implementation Checklist](#9-implementation-checklist)

---

## 1. Core Concept

```
┌──────────────────────────────────────────────────────────────────┐
│                     PHONE = IDENTITY                             │
│                                                                  │
│  Every trip stores:                                              │
│    • driverPhone      (always present)                           │
│    • receiverPhone    (always present — destination org phone)    │
│                                                                  │
│  If registered  → link via userId / orgId                        │
│  If NOT registered → keep phone only, disable live features      │
│                                                                  │
│  Later when they register with that phone →                      │
│    system auto-links ALL old trips to the new user               │
└──────────────────────────────────────────────────────────────────┘
```

**GPay analogy:**
- GPay lets you send money to a phone number. If recipient isn't on GPay, money sits pending.
- When recipient installs GPay with the same number → money auto-arrives.
- Here: trips sit "pending-linked" until the person registers.

---

## 2. What Already Exists (Your Head Start)

Your existing codebase **already has half of this system built** for drivers:

| Feature | Current State | Notes |
|---------|--------------|-------|
| `pendingDriverPhone` on `Trip` | ✅ Exists | Stores phone when driver isn't registered |
| `driverId` nullable on `Trip` | ✅ Exists | null when driver hasn't registered |
| `linkPendingDriverTrips()` in `AuthService` | ✅ Exists | Auto-links trips when driver registers |
| `@@index([pendingDriverPhone])` | ✅ Exists | Fast lookup for pending phone |
| Trip created without driver | ✅ Works | Status = `CREATED` instead of `ASSIGNED` |

**What's missing:**
- Equivalent system for **receivers (destination Mahajans)**
- Feature flag fields (`trackingEnabled`, `paymentEnabled`)
- Receiver linking on registration
- Unified guest detection helpers

---

## 3. Data Model Changes

### 3.1 Trip Model — Add Receiver Guest Fields

Your Trip model currently handles guest drivers via `pendingDriverPhone` + nullable `driverId`. The pattern is clean — **mirror it for receivers.**

```
Current Trip model (driver guest fields):
  driverId              String?           ← null if guest
  pendingDriverPhone    String?           ← phone if guest

ADD to Trip model (receiver guest fields):
  pendingReceiverPhone  String?           ← phone of destination org contact if not registered
  receiverRegistered    Boolean @default(true)   ← false if dest org phone not registered
  driverRegistered      Boolean @default(true)   ← false if driver phone not registered
  trackingEnabled       Boolean @default(true)   ← auto-computed at creation
  paymentEnabled        Boolean @default(true)   ← auto-computed at creation
```

#### Concrete Schema Diff

```prisma
model Trip {
  // ... existing fields ...

  driverId             String?
  driver               DriverProfile? @relation("DriverTrips", fields: [driverId], references: [id], onDelete: SetNull)
  pendingDriverPhone   String?          // ← ALREADY EXISTS

  // ✅ NEW: Receiver guest fields
  pendingReceiverPhone String?          // Phone of dest org contact if org not registered
  
  // ✅ NEW: Registration status flags
  driverRegistered     Boolean @default(true)
  receiverRegistered   Boolean @default(true)

  // ✅ NEW: Feature availability (computed from registration status)
  trackingEnabled      Boolean @default(true)
  paymentEnabled       Boolean @default(true)
  
  // ... rest of existing fields ...

  // ✅ NEW: Index for receiver linking
  @@index([pendingReceiverPhone])
}
```

### 3.2 Why NOT a Separate `GuestUser` Table?

You might think: "Should I create a `GuestUser` table?" **No.** Here's why:

| Approach | Pros | Cons |
|----------|------|------|
| Separate `GuestUser` table | Clean separation | Extra joins, migration complexity, two concepts of identity |
| **Fields on Trip** (✅ chosen) | Zero extra tables, mirrors existing `pendingDriverPhone` pattern, simpler queries | Denormalized (acceptable for this use case) |

Your existing architecture already chose the "fields on Trip" pattern for drivers. **Stay consistent.** Don't introduce a new pattern.

### 3.3 No Changes Needed to These Models

| Model | Change Needed? | Why |
|-------|---------------|-----|
| `User` | ❌ No | Phone is already unique, registration is already clean |
| `Org` | ❌ No | Org has phone field, no structural change needed |
| `DriverProfile` | ❌ No | Already handles linking correctly |
| `Account` / `LedgerEntry` | ❌ No | Already linked via `orgId` — only created when both orgs exist |
| `TripLocation` | ❌ No | Tracking data is only written when tracking is enabled |
| `ChatThread` | ❌ No | Chat threads are created per trip — still work for guest trips |

---

## 4. Trip Creation Decision Logic

### 4.1 Current Flow (Driver Only)

```
Mahajan creates trip
  ├─ driverPhone provided
  │   ├─ Driver registered?         → driverId = profile.id, status = ASSIGNED
  │   └─ Driver NOT registered?     → driverId = null, pendingDriverPhone = phone, status = CREATED
  └─ Trip always created ✅
```

### 4.2 New Flow (Driver + Receiver)

```
Mahajan creates trip with driverPhone + destinationOrgId
  │
  ├─── Step 1: CHECK DRIVER ─────────────────────────────────────
  │    │
  │    ├─ User with driverPhone exists AND is DRIVER role?
  │    │   → driverId = profile.id
  │    │   → driverRegistered = true
  │    │   → pendingDriverPhone = null
  │    │
  │    └─ User NOT found?
  │        → driverId = null
  │        → driverRegistered = false
  │        → pendingDriverPhone = driverPhone
  │
  ├─── Step 2: CHECK RECEIVER (Destination Org) ─────────────────
  │    │
  │    ├─ destinationOrgId provided AND org exists in DB?
  │    │   → normal flow (org already registered)
  │    │   → receiverRegistered = true
  │    │   → pendingReceiverPhone = null
  │    │
  │    └─ receiverPhone provided BUT no matching org?
  │        → receiverRegistered = false
  │        → pendingReceiverPhone = receiverPhone
  │        (see section 4.3 for how to handle dest org creation)
  │
  ├─── Step 3: COMPUTE FEATURE FLAGS ────────────────────────────
  │    │
  │    │   trackingEnabled  = driverRegistered
  │    │     (tracking requires a registered driver with the app)
  │    │
  │    │   paymentEnabled   = receiverRegistered
  │    │     (ledger/payments require both orgs to exist)
  │    │
  │    │   Note: The source Mahajan (trip creator) is ALWAYS
  │    │   registered — they're the one making the API call.
  │    │
  ├─── Step 4: SET TRIP STATUS ──────────────────────────────────
  │    │
  │    │   Both registered    → ASSIGNED
  │    │   Driver only guest  → CREATED (same as current)
  │    │   Receiver only guest → ASSIGNED (driver is ready)
  │    │   Both guest         → CREATED
  │    │
  └─── Step 5: CREATE TRIP ──────────────────────────────────────
       │
       │   Trip is ALWAYS created. No exceptions.
       │   Chat thread → created (sender can always chat)
       │   Ledger entry → only if paymentEnabled = true
       │   Driver payment → only if driverRegistered = true
       │
       └── Return trip with guest status indicators
```

### 4.3 Handling the Destination Org (Receiver)

**Important architectural decision:** Your current system requires `destinationOrgId` as a cuid reference. Receivers are organizations, not individual users. Here are two approaches:

#### Option A: Require `destinationOrgId` Always (Recommended)

Keep the current requirement. The source Mahajan must select an existing destination org.

**For guest receivers**, add a new flow:
- Mahajan provides `receiverPhone` (a phone number of the destination contact)
- System checks: does any `Org` have this `phone`?
  - **Yes** → use that org's ID, `receiverRegistered = true`
  - **No** → create a **placeholder org** with `name = "Pending ({phone})"`, `phone = receiverPhone`
    - `receiverRegistered = false`
    - `pendingReceiverPhone = receiverPhone`

When the receiver registers as MAHAJAN with that phone:
- System finds the placeholder org
- Updates org name, links user as OrgMember
- Marks `receiverRegistered = true` on all trips

#### Option B: Make `destinationOrgId` Nullable

Allow trips without a destination org. Simpler schema, but breaks your existing relations and queries.

**❌ Not recommended** — too many downstream changes.

---

### 4.4 Decision Matrix

| Driver Status | Receiver Status | Trip Status | Tracking | Payment | Ledger |
|:---:|:---:|:---:|:---:|:---:|:---:|
| ✅ Registered | ✅ Registered | `ASSIGNED` | ✅ On | ✅ On | ✅ Created |
| ❌ Guest | ✅ Registered | `CREATED` | ❌ Off | ✅ On | ✅ Created |
| ✅ Registered | ❌ Guest | `ASSIGNED` | ✅ On | ❌ Off | ❌ Deferred |
| ❌ Guest | ❌ Guest | `CREATED` | ❌ Off | ❌ Off | ❌ Deferred |

---

## 5. Registration Linking Logic

### 5.1 Current Driver Linking (Already Working)

```
AuthService.register()
  └── if role === DRIVER
        └── linkPendingDriverTrips(phone, driverProfile.id)
              └── UPDATE trips WHERE pendingDriverPhone = phone AND driverId IS NULL
                    SET driverId = profileId, pendingDriverPhone = null, status = ASSIGNED
```

This is clean and correct. **Extend the same pattern for receivers.**

### 5.2 New: Receiver Linking

```
AuthService.register()
  └── if role === MAHAJAN
        └── linkPendingReceiverTrips(phone, orgId)
              │
              ├── Find trips WHERE pendingReceiverPhone = phone
              │                AND receiverRegistered = false
              │
              ├── For each trip:
              │     UPDATE trip SET:
              │       receiverRegistered = true
              │       pendingReceiverPhone = null
              │       paymentEnabled = true   ← now both orgs exist
              │
              ├── Optionally: create ledger Account between sourceOrg ↔ new org
              │               (if not already exists)
              │
              └── Log: "Linked X trips to newly registered receiver"
```

### 5.3 Linking Flow Diagram

```
                    ┌─────────────────┐
                    │  New User        │
                    │  Registers with  │
                    │  phone +91XXXXX  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Which role?     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │                             │
     ┌────────▼────────┐          ┌────────▼────────┐
     │  DRIVER          │          │  MAHAJAN         │
     └────────┬────────┘          └────────┬────────┘
              │                             │
     ┌────────▼──────────────┐    ┌────────▼──────────────┐
     │  1. Create             │    │  1. Create User        │
     │     DriverProfile      │    │  2. Create Org         │
     │  2. Find trips where:  │    │  3. Create OrgMember   │
     │     pendingDriverPhone │    │  4. Find trips where:  │
     │     = this phone       │    │     pendingReceiver    │
     │     AND driverId null  │    │     Phone = this phone │
     │  3. For each trip:     │    │     AND receiver       │
     │     • set driverId     │    │     Registered = false │
     │     • set driverReg    │    │  5. For each trip:     │
     │       = true           │    │     • recvRegistered   │
     │     • clear pending    │    │       = true           │
     │       phone            │    │     • enable payment   │
     │     • set tracking     │    │     • clear pending    │
     │       Enabled = true   │    │       phone            │
     │     • update status    │    │     • create Account   │
     │       CREATED→ASSIGNED │    │       if needed        │
     └───────────────────────┘    └───────────────────────┘
```

### 5.4 Key Implementation Detail: Batch Update

**Don't update trips one-by-one in a loop** (your current `linkPendingDriverTrips` does this). At scale, use a batch update:

```
-- Instead of N individual updates:
UPDATE "Trip"
SET
  "driverId" = $1,
  "driverRegistered" = true,
  "pendingDriverPhone" = NULL,
  "trackingEnabled" = true,
  "status" = CASE WHEN "status" = 'CREATED' THEN 'ASSIGNED' ELSE "status" END
WHERE "pendingDriverPhone" = $2
  AND "driverId" IS NULL;
```

With Prisma, use `updateMany`:

```typescript
await prisma.trip.updateMany({
  where: {
    pendingDriverPhone: phone,
    driverId: null,
  },
  data: {
    driverId: driverProfileId,
    driverRegistered: true,
    pendingDriverPhone: null,
    trackingEnabled: true,
    // Note: updateMany can't do conditional status, handle separately if needed
  },
});
```

---

## 6. Feature Behavior Rules

### 6.1 For Guest Drivers (NOT Registered)

| Feature | Available? | Reason |
|---------|-----------|--------|
| Trip exists | ✅ Yes | Trip is always created |
| Mahajan sees trip | ✅ Yes | Creator always has access |
| Live GPS tracking | ❌ No | Driver doesn't have the app installed |
| Location history | ❌ No | No driver app → no pings |
| Driver payment ledger | ⚠️ Created but dormant | Record exists, marked PENDING |
| Status updates by driver | ❌ No | Driver can't authenticate |
| Load card creation | ✅ Yes | Source Mahajan creates this |
| Chat with driver | ❌ No | Driver not on platform |
| SMS invite to driver | ✅ Yes (NEW) | Send invite link via SMS |

### 6.2 For Guest Receivers (Destination NOT Registered)

| Feature | Available? | Reason |
|---------|-----------|--------|
| Trip exists | ✅ Yes | Trip is always created |
| Source Mahajan sees trip | ✅ Yes | Creator always has access |
| Receiver sees trip | ❌ No | Receiver doesn't have the app |
| Receive card creation | ❌ No | No authenticated receiver |
| Ledger entry creation | ❌ Deferred | Need both orgs for Account |
| Payment tracking | ❌ Deferred | No Account = no payments on platform |
| Invoice generation | ❌ Deferred | Need receiver org |
| Chat with receiver | ❌ No | Receiver not on platform |
| Trip tracking by receiver | ❌ No | Receiver not on platform |
| SMS invite to receiver | ✅ Yes (NEW) | Send invite link via SMS |

### 6.3 For Source Mahajan (ALWAYS Registered)

| Feature | Available? | Notes |
|---------|-----------|-------|
| Create trip | ✅ Always | Core feature, never blocked |
| View trip | ✅ Always | Own trips always visible |
| Create load card | ✅ Always | Source-side action |
| View tracking (if driver registered) | ✅ Conditional | Only if `trackingEnabled` |
| Create ledger entry (if receiver registered) | ✅ Conditional | Only if `paymentEnabled` |
| Chat | ✅ Partial | Can chat in trip thread — messages wait for other party |

### 6.4 Service-Layer Guard Pattern

In your existing services, add guard checks:

```
TrackingService.storePings():
  → Check trip.trackingEnabled before accepting pings
  → If false: return { accepted: false, reason: "Driver not registered" }

TrackingService.getLatestLocation():
  → Check trip.trackingEnabled
  → If false: return { available: false, reason: "Tracking not available for this trip" }

LedgerService.createInvoice():
  → Check trip.paymentEnabled
  → If false: throw ValidationError("Payment features unavailable — receiver not yet registered")

LedgerService.createPayment():
  → Same paymentEnabled check
```

---

## 7. Edge Cases

### 7.1 Same Phone Registers Later

**Scenario:** Trip created today with `driverPhone: +919876543210`. Driver registers 3 weeks later.

**Handling:** Already covered by `linkPendingDriverTrips()`. The index `@@index([pendingDriverPhone])` ensures fast lookup even after weeks/months.

**No time limit.** Trips never expire from the pending queue. They link whenever the person registers, even years later.

### 7.2 Phone Number Change

**Scenario:** Driver's SIM changes. They register with a new number.

**Handling:**
- Old trips remain linked to the old phone number (never linked).
- This is the **correct behavior** — you can't know the new number maps to the same person.
- **Future enhancement:** Admin endpoint to manually re-link:
  ```
  POST /admin/remap-phone
  { oldPhone: "+91...", newPhone: "+91...", tripIds: [...] }
  ```
- Log this action for audit.

### 7.3 Duplicate Accounts

**Scenario:** Person registers twice with different phones (e.g., personal + business).

**Handling:**
- Each phone = separate user. This is correct.
- Trips linked to each phone stay with that user.
- **Future enhancement:** Account merge endpoint (like WhatsApp Business merge):
  ```
  POST /admin/merge-users
  { primaryUserId: "...", secondaryUserId: "...", reason: "..." }
  ```

### 7.4 Partial Registration

**Scenario:** User starts OTP verification but never completes `register()`.

**Handling:**
- No `User` record is created (register hasn't been called).
- `linkPendingDriverTrips()` is never triggered.
- Trips stay pending. No issue.
- **Your current flow already handles this** — `verifyWidgetToken()` only returns a `verificationToken`, actual user creation happens in `register()`.

### 7.5 Wrong Role Registration

**Scenario:** Mahajan creates trip with `driverPhone: +91XXXXX`. That person registers as MAHAJAN instead of DRIVER.

**Handling:**
- `linkPendingDriverTrips()` only fires for `role === DRIVER`.
- The trip stays pending with `pendingDriverPhone`.
- This is **correct** — if they didn't register as a driver, they can't drive.
- If it's a mistake, they'd need to re-register or have an admin fix it.

### 7.6 Org Already Exists for Receiver Phone

**Scenario:** Mahajan enters `receiverPhone: +91XXXXX`. An `Org` with that phone already exists.

**Handling:**
- Look up org by phone: `await prisma.org.findFirst({ where: { phone: receiverPhone } })`
- If found → use that org as destination. `receiverRegistered = true`.
- If not found → guest flow.

### 7.7 Multiple Orgs with Same Phone

**Scenario:** Two orgs have the same phone number.

**Handling:**
- Org.phone is NOT unique in your schema (no `@unique` on it).
- When linking, use `findFirst` and match the most likely org (by city, name, etc.).
- **Better:** Add validation in org creation to prevent duplicate phones, OR prompt the Mahajan to select which org they mean.

### 7.8 Future Analytics & Conversion Tracking

Add fields to track conversion funnel:

```prisma
model Trip {
  // ... existing fields ...

  // ✅ NEW: Conversion tracking
  driverInvitedAt       DateTime?     // When SMS invite was sent to driver
  driverLinkedAt        DateTime?     // When driver registered and was linked
  receiverInvitedAt     DateTime?     // When SMS invite was sent to receiver
  receiverLinkedAt      DateTime?     // When receiver registered and was linked
}
```

This enables dashboards:
- "X% of invited drivers registered"
- "Average time from invite to registration: Y days"
- "Z trips pending unregistered drivers"

### 7.9 SMS Invite Flow

```
┌─────────────────────────────────────┐
│  Mahajan creates trip               │
│  with unregistered driver phone     │
│                                     │
│  → System sends SMS:                │
│  "You've been added to a trip       │
│   on Mahajan App. Download:         │
│   https://mahajan.app/invite/XYZ    │
│   and register with +91XXXXXXX"    │
│                                     │
│  → Store driverInvitedAt = now()    │
│                                     │
│  When driver clicks link:           │
│  → Opens app / play store           │
│  → Registers with same phone        │
│  → linkPendingDriverTrips() fires   │
│  → Store driverLinkedAt = now()     │
└─────────────────────────────────────┘
```

---

## 8. Scaling Considerations

### 8.1 Index Strategy

Your existing indexes are well-designed. Add:

```prisma
@@index([pendingReceiverPhone])          // Fast receiver linking
@@index([driverRegistered, status])      // Filter "guest driver trips"
@@index([receiverRegistered, status])    // Filter "guest receiver trips"
```

**At millions of trips**, the `pendingDriverPhone` and `pendingReceiverPhone` indexes will be sparse (most trips have registered parties). Sparse indexes are inherently fast because they only contain entries for non-null values.

### 8.2 Linking Performance

| Scale | Trips per phone | Linking time | Strategy |
|-------|----------------|--------------|----------|
| < 1K trips | 1-10 | < 50ms | Loop update (current approach) |
| 1K-100K trips | 10-100 | < 200ms | `updateMany` batch |
| 100K+ trips | 100+ per phone | < 500ms | Raw SQL `UPDATE...WHERE` |

Your current `for` loop in `linkPendingDriverTrips()` works fine now. When you hit scale, switch to `updateMany`. The index on `pendingDriverPhone` ensures the WHERE clause is O(log n) regardless of total trip count.

### 8.3 Registration is a Critical Path

The linking logic runs inside `register()`. Keep it fast:

```
register()
  ├── Create User (1 write)
  ├── Create Org/DriverProfile (1 write)
  ├── Link pending trips (1 read + 1 batch write)  ← keep this fast
  └── Generate tokens (CPU only)
```

**If linking becomes slow** (>500ms), move it to an async job:
1. Register returns tokens immediately
2. Queue a `LINK_PENDING_TRIPS` job
3. Worker processes the linking
4. Send push notification: "X trips have been linked to your account"

### 8.4 Redis Caching Strategy

For trip queries, include guest status in cache keys:

```
trip:{tripId}                    → existing (include new fields)
trips:pending:driver:{phone}     → list of trip IDs pending for this driver
trips:pending:receiver:{phone}   → list of trip IDs pending for this receiver
```

When linking occurs, invalidate these keys.

---

## 9. Implementation Checklist

### Phase 1: Schema & Core Logic (Minimal Changes)

- [ ] **Migration:** Add fields to Trip model
  - `pendingReceiverPhone String?`
  - `driverRegistered Boolean @default(true)`
  - `receiverRegistered Boolean @default(true)`
  - `trackingEnabled Boolean @default(true)`
  - `paymentEnabled Boolean @default(true)`
  - `@@index([pendingReceiverPhone])`

- [ ] **`trip.dto.ts`:** Add `receiverPhone` as optional field in `createTripSchema`

- [ ] **`trip.service.ts` → `createTrip()`:**
  - Add receiver phone lookup logic
  - Compute `driverRegistered`, `receiverRegistered`
  - Compute `trackingEnabled`, `paymentEnabled`
  - Set `pendingReceiverPhone` if receiver not registered

- [ ] **`auth.service.ts` → `register()`:**
  - Add `linkPendingReceiverTrips()` for MAHAJAN role
  - Mirrors existing `linkPendingDriverTrips()` pattern

### Phase 2: Service Guards

- [ ] **`tracking.service.ts`:** Check `trackingEnabled` in `storePings()`, `getLatestLocation()`
- [ ] **`ledger.service.ts`:** Check `paymentEnabled` in `createInvoice()`, `createPayment()`
- [ ] **Trip API responses:** Include `driverRegistered`, `receiverRegistered`, `trackingEnabled`, `paymentEnabled` in all trip responses

### Phase 3: Invite System (Optional Enhancement)

- [ ] **SMS invite endpoint:** `POST /trips/:id/invite-driver`, `POST /trips/:id/invite-receiver`
- [ ] **Conversion tracking fields:** `driverInvitedAt`, `receiverInvitedAt`, `driverLinkedAt`, `receiverLinkedAt`
- [ ] **Admin dashboard:** Pending trips, conversion funnel

### Phase 4: Refactor for Scale (When Needed)

- [ ] Batch-update `linkPendingDriverTrips()` with `updateMany`
- [ ] Async linking via job queue (if registration becomes slow)
- [ ] Admin merge/remap endpoints

---

## Summary

| Aspect | Design Decision | Rationale |
|--------|----------------|-----------|
| **Data model** | Fields on Trip, no new tables | Matches existing `pendingDriverPhone` pattern |
| **Identity** | Phone number as placeholder | Universal, simple, matches GPay model |
| **Linking** | On registration, batch update | Automatic, no manual intervention needed |
| **Feature flags** | `trackingEnabled` / `paymentEnabled` on Trip | Service-layer guards, not UI hacks |
| **Destination org** | Placeholder org for unregistered receivers | Keeps `destinationOrgId` non-nullable |
| **Scale strategy** | Indexed phone fields + batch updates | O(log n) lookups, O(1) linking per trip |
| **Breaking changes** | **Zero** | All new fields are nullable/have defaults |

**Total schema changes: 5 new fields + 1 new index on the Trip model. Zero new tables. Zero breaking changes.**
