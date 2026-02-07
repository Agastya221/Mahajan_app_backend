# Implementation Spec: Independent Drivers, No Staff System, Flexible Driver Payments & GST Verification

## Context

This is the Mahajan Network Platform — a B2B vegetable logistics system. Read the full codebase before making changes. The key files are:
- `prisma/schema.prisma` (full schema)
- `src/auth/auth.service.ts` & `src/auth/auth.dto.ts` (registration flow)
- `src/trips/trip.service.ts` & `src/trips/trip.dto.ts` (trip creation)
- `src/drivers/driver.service.ts` & `src/drivers/driver.dto.ts`
- `src/org/org.service.ts` & `src/org/org.dto.ts`
- `src/middleware/rbac.middleware.ts`
- `prisma/seed.ts`
- `src/export/export.service.ts`

---

## PART 1: Remove Staff System & Simplify Roles

### 1.1 — Schema Changes (prisma/schema.prisma)

**Replace the `UserRole` enum:**
```
// BEFORE
enum UserRole {
  MAHAJAN_OWNER
  MAHAJAN_STAFF
  DRIVER
}

// AFTER
enum UserRole {
  MAHAJAN
  DRIVER
}
```

**Remove `OrgMemberRole` enum entirely.** We no longer need OWNER/STAFF distinction.

**Simplify `OrgMember` model** — remove the `role` field. Every mahajan is the sole owner of their Org. The OrgMember model still exists to link User ↔ Org but has no role:
```prisma
model OrgMember {
  id        String   @id @default(cuid())
  orgId     String
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, userId])
  @@index([userId])
  @@index([orgId])
}
```

**Add GST and verification fields to `User` model:**
```prisma
model User {
  id           String    @id @default(cuid())
  role         UserRole
  name         String
  phone        String    @unique
  passwordHash String?
  gstin        String?   @unique  // Optional GST number for mahajans
  isVerified   Boolean   @default(false)  // True when GST is verified — shows badge
  status       String    @default("ACTIVE")
  suspendedAt  DateTime?
  bannedAt     DateTime?
  statusReason String?
  // ... rest of relations unchanged
}
```

### 1.2 — Auth Changes

**`src/auth/auth.dto.ts`** — Update the register schema to support two registration routes:

```typescript
// Normal registration — becomes MAHAJAN
export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  verificationToken: z.string().min(1),
  registerAs: z.enum(['MAHAJAN', 'DRIVER']).default('MAHAJAN'),
});
```

No referral code or mahajan phone number needed for drivers. Drivers simply choose the "Driver" registration path in the app.

**`src/auth/auth.service.ts`** — Update the `register()` method:

```typescript
// BEFORE: role: UserRole.MAHAJAN_STAFF
// AFTER:
const role = data.registerAs === 'DRIVER' ? UserRole.DRIVER : UserRole.MAHAJAN;

const user = await prisma.user.create({
  data: {
    phone: decoded.phone,
    name: data.name,
    role,
  },
});

// If MAHAJAN, auto-create Org and OrgMember
if (role === UserRole.MAHAJAN) {
  const org = await prisma.org.create({
    data: {
      name: `${data.name}'s Business`,
      phone: decoded.phone,
    },
  });

  await prisma.orgMember.create({
    data: {
      orgId: org.id,
      userId: user.id,
    },
  });
}

// If DRIVER, auto-create empty DriverProfile
if (role === UserRole.DRIVER) {
  await prisma.driverProfile.create({
    data: {
      userId: user.id,
    },
  });
}
```

### 1.3 — RBAC Middleware

**`src/middleware/rbac.middleware.ts`** — Update:
- `requireRole()`: Replace all `MAHAJAN_OWNER` / `MAHAJAN_STAFF` checks with just `MAHAJAN`
- `requireOrgMember()`: Keep as-is (checks OrgMember exists, no role check needed)
- `requireOrgAdmin()`: Simplify to just check membership (every mahajan is owner of their org). Rename to `requireOrgMember` or just merge logic.

### 1.4 — Org Service

**`src/org/org.service.ts`**:
- `addMember()` / `removeMember()` / `updateMemberRole()`: Remove these methods entirely or simplify. There are no staff members to add/remove. Each Org has exactly one owner (the mahajan who created it).
- Keep `createOrg()`, `updateOrg()`, `getOrg()`, `getOrgs()`, `deleteOrg()`
- Remove `OrgMemberRole` imports everywhere

**`src/org/org.dto.ts`**:
- Remove `addMemberSchema` and the `OrgMemberRole` import
- Remove `role` from any member-related DTOs

---

## PART 2: Independent Drivers (No Org Binding)

### 2.1 — Schema Changes

**`DriverProfile`** — Remove `orgId` and `org` relation. Drivers are independent:
```prisma
model DriverProfile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  licenseNo      String?
  emergencyPhone String?
  notes          String?
  deviceId       String?  @unique

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  trips     Trip[]   @relation("DriverTrips")
  locations TripLocation[]
}
```

**`Org` model** — Remove the `drivers DriverProfile[]` relation.

### 2.2 — Driver Service

**`src/drivers/driver.service.ts`** — Update:
- `createDriver()`: Remove orgId validation. DriverProfile is created automatically during registration, so this method may only be used for admin-level profile updates.
- `getDrivers()`: Remove orgId filter. Drivers are global. Add search by phone number.
- Add new method: `findOrInviteDriverByPhone(phone: string)` — used during trip assignment.

```typescript
async findDriverByPhone(phone: string) {
  const user = await prisma.user.findUnique({
    where: { phone },
    include: {
      driverProfile: true,
    },
  });

  if (!user) return null;
  if (user.role !== UserRole.DRIVER) return null;
  
  return user.driverProfile;
}
```

### 2.3 — Driver DTO

**`src/drivers/driver.dto.ts`** — Remove `orgId` from `CreateDriverDto` and `UpdateDriverDto`.

---

## PART 3: Trip Driver Assignment by Phone Number

### 3.1 — Trip DTO Changes

**`src/trips/trip.dto.ts`** — Update `createTripSchema`:

```typescript
export const createTripSchema = z.object({
  sourceOrgId: z.string().cuid('Invalid source organization ID'),
  destinationOrgId: z.string().cuid('Invalid destination organization ID'),
  truckNumber: z.string().min(1, 'Truck number is required'),  // Enter truck number directly
  driverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number'),  // Driver's phone
  startPoint: z.string().min(1, 'Start point is required'),
  endPoint: z.string().min(1, 'End point is required'),
  estimatedDistance: z.number().positive().optional(),
  estimatedArrival: z.string().datetime().optional(),
  notes: z.string().optional(),
  // Driver payment config
  driverPaymentAmount: z.number().positive().optional(),
  driverPaymentPaidBy: z.enum(['SOURCE', 'DESTINATION', 'SPLIT']).optional(),
  driverPaymentSplitSourceAmount: z.number().positive().optional(),  // Only if SPLIT
  driverPaymentSplitDestAmount: z.number().positive().optional(),    // Only if SPLIT
});
```

### 3.2 — Trip Service Changes

**`src/trips/trip.service.ts`** — Rewrite `createTrip()`:

```typescript
async createTrip(data: CreateTripDto, createdBy: string) {
  // 1. Validate user is member of the source org
  const sourceMembership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId: data.sourceOrgId, userId: createdBy } },
  });
  if (!sourceMembership) throw new ForbiddenError('Not a member of the source organization');

  // 2. Validate source ≠ destination
  if (data.sourceOrgId === data.destinationOrgId) {
    throw new ValidationError('Source and destination must be different');
  }

  // 3. Find or create Truck by number (trucks are no longer org-locked)
  let truck = await prisma.truck.findFirst({
    where: { number: data.truckNumber },
  });
  if (!truck) {
    truck = await prisma.truck.create({
      data: { number: data.truckNumber, orgId: data.sourceOrgId },
    });
  }

  // 4. Find driver by phone number
  const driverUser = await prisma.user.findUnique({
    where: { phone: data.driverPhone },
    include: { driverProfile: true },
  });

  let driverProfileId: string | null = null;

  if (driverUser) {
    if (driverUser.role !== UserRole.DRIVER || !driverUser.driverProfile) {
      throw new ValidationError('The phone number does not belong to a registered driver');
    }
    driverProfileId = driverUser.driverProfile.id;
  }
  // If driver doesn't exist yet, trip is created without driver (CREATED status)
  // The driver can register later and be linked via phone number

  // 5. Create the trip
  const trip = await prisma.$transaction(async (tx) => {
    const newTrip = await tx.trip.create({
      data: {
        sourceOrgId: data.sourceOrgId,
        destinationOrgId: data.destinationOrgId,
        truckId: truck.id,
        driverId: driverProfileId,
        startPoint: data.startPoint,
        endPoint: data.endPoint,
        estimatedDistance: data.estimatedDistance,
        status: driverProfileId ? TripStatus.ASSIGNED : TripStatus.CREATED,
        notes: data.notes,
      },
      include: {
        sourceOrg: true,
        destinationOrg: true,
        truck: true,
        driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    // 6. Create TripEvent
    await tx.tripEvent.create({
      data: {
        tripId: newTrip.id,
        eventType: driverProfileId ? TripEventType.ASSIGNED : TripEventType.TRIP_CREATED,
        description: driverProfileId
          ? `Trip created and assigned to driver ${data.driverPhone}`
          : `Trip created, driver ${data.driverPhone} not yet registered`,
        createdByUserId: createdBy,
      },
    });

    // 7. Create DriverPayment record if payment info provided
    if (data.driverPaymentAmount) {
      await tx.driverPayment.create({
        data: {
          tripId: newTrip.id,
          totalAmount: data.driverPaymentAmount,
          paidBy: data.driverPaymentPaidBy || 'SOURCE',
          splitSourceAmount: data.driverPaymentSplitSourceAmount,
          splitDestAmount: data.driverPaymentSplitDestAmount,
          status: 'PENDING',
        },
      });
    }

    return newTrip;
  });

  return trip;
}
```

Also add a method to link a driver who registers after trip creation:
```typescript
async linkPendingDriverByPhone(driverPhone: string, driverProfileId: string) {
  // Find all trips that have this phone stored but no driverId
  // This would need a `driverPhone` field on Trip (see schema below)
  const pendingTrips = await prisma.trip.findMany({
    where: {
      pendingDriverPhone: driverPhone,
      driverId: null,
      status: TripStatus.CREATED,
    },
  });

  for (const trip of pendingTrips) {
    await prisma.trip.update({
      where: { id: trip.id },
      data: {
        driverId: driverProfileId,
        pendingDriverPhone: null,
        status: TripStatus.ASSIGNED,
      },
    });
  }
}
```

### 3.3 — Trip Schema Addition

Add `pendingDriverPhone` to the Trip model for cases where the driver hasn't registered yet:

```prisma
model Trip {
  // ... existing fields
  pendingDriverPhone String?  // Phone of driver who hasn't registered yet
  // ... rest unchanged
  
  @@index([pendingDriverPhone])
}
```

---

## PART 4: Flexible Driver Payment Model

### 4.1 — New Schema

Add new enum and model:

```prisma
enum DriverPaymentPaidBy {
  SOURCE        // Source mahajan pays full amount
  DESTINATION   // Destination mahajan pays full amount
  SPLIT         // Split between both mahajans
}

enum DriverPaymentStatus {
  PENDING
  PARTIALLY_PAID
  PAID
  DISPUTED
}

model DriverPayment {
  id                   String               @id @default(cuid())
  tripId               String               @unique
  trip                 Trip                  @relation(fields: [tripId], references: [id], onDelete: Cascade)
  
  totalAmount          Decimal              @db.Decimal(12, 2)
  paidBy               DriverPaymentPaidBy  @default(SOURCE)
  
  // Split amounts (only when paidBy = SPLIT)
  splitSourceAmount    Decimal?             @db.Decimal(12, 2)
  splitDestAmount      Decimal?             @db.Decimal(12, 2)
  
  // Payment tracking
  paidAmount           Decimal              @default(0) @db.Decimal(12, 2)
  status               DriverPaymentStatus  @default(PENDING)
  paidAt               DateTime?
  remarks              String?
  
  createdAt            DateTime             @default(now())
  updatedAt            DateTime             @updatedAt
  
  @@index([status])
  @@index([tripId])
}
```

Add the relation to `Trip` model:
```prisma
model Trip {
  // ... existing relations
  driverPayment  DriverPayment?
}
```

### 4.2 — New Service: DriverPaymentService

Create `src/driver-payments/driver-payment.service.ts` with:
- `createOrUpdateDriverPayment(tripId, data)` — set/update payment terms
- `recordDriverPayment(tripId, amount, paidByOrgId)` — record a partial/full payment
- `getDriverPaymentStatus(tripId)` — check if pending/paid
- `getPendingDriverPayments(orgId)` — list all unpaid driver payments for a mahajan

### 4.3 — New Routes

Create `src/driver-payments/driver-payment.routes.ts`:
- `POST /trips/:tripId/driver-payment` — create/update payment terms
- `POST /trips/:tripId/driver-payment/record` — record payment made
- `GET /trips/:tripId/driver-payment` — get payment status
- `GET /orgs/:orgId/pending-driver-payments` — list all pending payments

---

## PART 5: GST Verification on User

### 5.1 — New Route for GST Submission

Add to user routes or create `src/users/user.routes.ts`:
- `POST /users/me/gstin` — submit GST number for verification
- `GET /users/me/gstin` — get GST status

### 5.2 — Service Logic

```typescript
async submitGstin(userId: string, gstin: string) {
  // Validate GSTIN format (15 chars: 2-digit state + 10 PAN + 1 entity + 1 Z + 1 check)
  // Store it. isVerified stays false until admin/system verifies.
  return prisma.user.update({
    where: { id: userId },
    data: { gstin, isVerified: false },
  });
}

async verifyGstin(userId: string) {
  // Admin-only or automated. Sets isVerified = true.
  return prisma.user.update({
    where: { id: userId },
    data: { isVerified: true },
  });
}
```

---

## PART 6: Files to Update (Checklist)

### Schema & Migration
- [ ] `prisma/schema.prisma` — All changes above
- [ ] Run `npx prisma migrate dev --name remove-staff-independent-drivers-gst`

### Auth
- [ ] `src/auth/auth.dto.ts` — Add `registerAs` field
- [ ] `src/auth/auth.service.ts` — Update register() for MAHAJAN/DRIVER, auto-create Org or DriverProfile

### Org
- [ ] `src/org/org.service.ts` — Remove addMember, removeMember, updateMemberRole
- [ ] `src/org/org.dto.ts` — Remove addMemberSchema, OrgMemberRole imports
- [ ] `src/org/org.routes.ts` — Remove member management routes

### Drivers
- [ ] `src/drivers/driver.service.ts` — Remove orgId logic, add findByPhone
- [ ] `src/drivers/driver.dto.ts` — Remove orgId from DTOs
- [ ] `src/drivers/driver.routes.ts` — Update routes

### Trips
- [ ] `src/trips/trip.dto.ts` — Replace driverId/truckId with driverPhone/truckNumber
- [ ] `src/trips/trip.service.ts` — Rewrite createTrip with phone-based driver lookup

### Driver Payments (NEW)
- [ ] `src/driver-payments/driver-payment.service.ts` — Create
- [ ] `src/driver-payments/driver-payment.dto.ts` — Create
- [ ] `src/driver-payments/driver-payment.routes.ts` — Create
- [ ] Register routes in `src/app.ts` or main router

### RBAC
- [ ] `src/middleware/rbac.middleware.ts` — Replace MAHAJAN_OWNER/MAHAJAN_STAFF with MAHAJAN

### Seed
- [ ] `prisma/seed.ts` — Update to use new roles, remove staff user, make drivers independent

### Export
- [ ] `src/export/export.service.ts` — Add driver payment columns to Excel export

### General
- [ ] Search entire codebase for `MAHAJAN_OWNER`, `MAHAJAN_STAFF`, `OrgMemberRole` and replace/remove
- [ ] Search for `driver.orgId` or `orgId` in driver-related code and remove
- [ ] Update any API response types/interfaces

---

## CRITICAL RULES

1. **Do NOT break existing Prisma relations** — when removing fields, check all `@relation` and `@@index` references
2. **Handle the UserRole enum migration carefully** — Prisma enum changes require data migration if there's existing data. Add a migration step to convert `MAHAJAN_OWNER` → `MAHAJAN` and `MAHAJAN_STAFF` → `MAHAJAN` in existing rows before changing the enum
3. **Keep the Org model** — it represents the mahajan's business entity for trips, ledger, invoices. Each mahajan gets one Org auto-created on registration
4. **Trucks stay org-associated for now** but the unique constraint changes from `@@unique([orgId, number])` to just `@@unique([number])` since truck numbers are nationally unique
5. **Test the full auth flow**: OTP → verify → register as MAHAJAN → auto-create Org + OrgMember. OTP → verify → register as DRIVER → auto-create DriverProfile
6. **Pending driver phone**: When a trip is created with a phone number that doesn't exist yet, store it in `pendingDriverPhone`. When that driver registers, call `linkPendingDriverByPhone()` to assign them
