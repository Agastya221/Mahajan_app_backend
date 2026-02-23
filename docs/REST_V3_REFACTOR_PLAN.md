# Mahajan Network — REST API v3 Refactoring Plan

**Author:** Backend Architecture Review  
**Date:** 2026-02-23  
**Status:** PROPOSAL — requires approval before implementation  
**Scope:** API surface refactoring only. Zero changes to business logic, DB schema, or domain models.

---

## Table of Contents

1. [Refactored Endpoint List](#1-refactored-endpoint-list)
2. [Migration Mapping (v2 → v3)](#2-migration-mapping-v2--v3)
3. [API Conventions](#3-api-conventions)
4. [Chat System Contract](#4-chat-system-contract)
5. [Implementation Strategy](#5-implementation-strategy)

---

## 1. Refactored Endpoint List

**Base URL:** `https://api.mahajan.network/v3`  
(Development: `http://localhost:3000/api/v3`)

### 1.1 Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/auth/widget-config` | Get MSG91 OTP widget config |
| `POST` | `/auth/tokens` | Verify OTP token (login / create session) |
| `POST` | `/auth/tokens/refresh` | Refresh access token (rotates refresh token) |
| `POST` | `/auth/register` | Complete registration for new users |
| `DELETE` | `/auth/tokens` | Logout (revoke tokens) |

> **Change rationale:** `verify-widget-token` → `POST /auth/tokens` because login is "creating a session token". `POST /auth/logout` → `DELETE /auth/tokens` because logout is "destroying the token resource".

---

### 1.2 Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/users/me` | Get current user profile |
| `PATCH` | `/users/me` | Update current user profile |
| `GET` | `/users/me/gstin` | Get GSTIN verification status |
| `PUT` | `/users/me/gstin` | Submit/update GSTIN |

> **Change:** `POST /users/me/gstin` → `PUT` because GSTIN is a singleton sub-resource (idempotent upsert).

---

### 1.3 Organizations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/orgs` | Create organization |
| `GET` | `/orgs` | List user's orgs. Supports `?search=` for global search |
| `GET` | `/orgs/:orgId` | Get org by ID |
| `PATCH` | `/orgs/:orgId` | Update org |
| `DELETE` | `/orgs/:orgId` | Delete org |

> **Change:** Merged `GET /orgs/search?query=` into `GET /orgs?search=`. Search is a filter, not a resource. The `search` param triggers cross-org search mode, while no `search` param returns only the user's own orgs.

---

### 1.4 Org Sub-Resources (Items, Trucks, Exports)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/orgs/:orgId/items` | Create item |
| `GET` | `/orgs/:orgId/items` | List items (`?search=`, `?category=`) |
| `GET` | `/orgs/:orgId/items/categories` | Get distinct categories |
| `GET` | `/orgs/:orgId/items/:itemId` | Get item |
| `PATCH` | `/orgs/:orgId/items/:itemId` | Update item |
| `DELETE` | `/orgs/:orgId/items/:itemId` | Soft-delete item |
| `POST` | `/orgs/:orgId/trucks` | Create truck |
| `GET` | `/orgs/:orgId/trucks` | List trucks |
| `GET` | `/orgs/:orgId/trucks/:truckId` | Get truck |
| `PATCH` | `/orgs/:orgId/trucks/:truckId` | Update truck |
| `DELETE` | `/orgs/:orgId/trucks/:truckId` | Delete truck |
| `POST` | `/orgs/:orgId/exports` | Generate export |
| `GET` | `/orgs/:orgId/exports` | Get export history |

> **Change:** Items already used `/items/:orgId` — just swap to `/orgs/:orgId/items` for consistency. Trucks currently use top-level `/trucks?orgId=` — moved under org. Exports already used `/exports/:orgId` — standardized to `/orgs/:orgId/exports`.

---

### 1.5 Drivers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/drivers` | Create driver profile |
| `GET` | `/drivers` | List drivers (`?phone=`, `?search=`) |
| `GET` | `/drivers/:driverId` | Get driver by ID |
| `PATCH` | `/drivers/:driverId` | Update driver |
| `DELETE` | `/drivers/:driverId` | Delete driver |
| `GET` | `/drivers/:driverId/trips` | Get driver's trips (`?status=ACTIVE`) |

> **Changes:**
> - Merged `GET /drivers/search?phone=` into `GET /drivers?phone=`. Phone search is filtering.
> - Moved `GET /tracking/drivers/:driverId/active-trips` → `GET /drivers/:driverId/trips?status=ACTIVE`. Trips are a sub-resource of drivers.

---

### 1.6 Trips

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/trips` | Create trip |
| `GET` | `/trips` | List trips (`?orgId=`, `?status=`, `?cursor=`, `?limit=`) |
| `GET` | `/trips/:tripId` | Get trip with full details |
| `PATCH` | `/trips/:tripId` | Update trip (status, fields, cancel, driver/truck change — all via one endpoint) |
| `POST` | `/trips/:tripId/load-card` | Create load card |
| `POST` | `/trips/:tripId/receive-card` | Create receive card |
| `GET` | `/trips/:tripId/locations` | Get GPS location history |
| `GET` | `/trips/:tripId/locations/latest` | Get latest GPS location |
| `POST` | `/trips/:tripId/locations` | Submit GPS pings (driver only) |
| `GET` | `/trips/:tripId/driver-payment` | Get driver payment status |
| `PUT` | `/trips/:tripId/driver-payment` | Create/update driver payment terms |
| `POST` | `/trips/:tripId/driver-payment/records` | Record a payment to driver |

> **Major changes:**
> 1. **Unified PATCH** — `PATCH /trips/:tripId/status`, `POST /trips/:tripId/cancel`, and `POST /trips/:tripId/change-driver` are all merged into a single `PATCH /trips/:tripId`. The body determines what changes:
>    - `{ "status": "CANCELLED", "cancelReason": "..." }` — cancel
>    - `{ "status": "IN_TRANSIT" }` — status transition
>    - `{ "driverPhone": "...", "truckNumber": "...", "changeReason": "..." }` — driver/truck change
>    - `{ "notes": "...", "estimatedArrival": "..." }` — field edits
> 2. **Tracking under trips** — `GET /tracking/trips/:tripId/locations` → `GET /trips/:tripId/locations`. GPS is a sub-resource of the trip, not a separate module.
> 3. **Driver payment** — `POST .../driver-payment/record` → `POST .../driver-payment/records` (resource naming).

---

### 1.7 Ledger & Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/accounts` | Create/get account between two orgs |
| `GET` | `/accounts` | List accounts (`?orgId=`) |
| `GET` | `/accounts/:accountId` | Get account details |
| `GET` | `/accounts/:accountId/entries` | Get ledger entries (cursor paginated) |
| `GET` | `/accounts/:accountId/invoices` | List invoices |
| `GET` | `/accounts/:accountId/payments` | List payments (`?status=PENDING`) |

> **Change:** `GET .../timeline` → `GET .../entries`. "Timeline" is a UI concept; "entries" is the resource name. Also, `pending-payments` becomes a filter: `GET .../payments?status=PENDING`.

---

### 1.8 Invoices (top-level resource)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/invoices` | Create invoice |
| `GET` | `/invoices/:invoiceId` | Get invoice |
| `PATCH` | `/invoices/:invoiceId` | Update invoice (status, fields) |

> **Change:** Removed `/ledger/` prefix. Invoices are a first-class resource.

---

### 1.9 Payments (top-level resource)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/payments` | Create payment (direct record) |
| `POST` | `/payments/requests` | Create payment request |
| `GET` | `/payments/:paymentId` | Get payment by ID |
| `PATCH` | `/payments/:paymentId` | Update payment status |

> **Major change — Unified PATCH:**
> All of these RPC endpoints collapse into one:
> - `POST /ledger/payments/mark-paid` → `PATCH /payments/:id { "status": "MARKED_AS_PAID", "utrNumber": "..." }`
> - `POST /ledger/payments/confirm` → `PATCH /payments/:id { "status": "CONFIRMED" }`
> - `POST /ledger/payments/dispute` → `PATCH /payments/:id { "status": "DISPUTED", "disputeReason": "..." }`
>
> The controller inspects the `status` field and routes to the appropriate business logic. Authorization is enforced per-status (e.g., only receiver can CONFIRM).

---

### 1.10 Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/chat/threads` | Create/get org-pair thread |
| `GET` | `/chat/threads` | List threads (cursor paginated) |
| `GET` | `/chat/threads/:threadId` | Get thread by ID |
| `PATCH` | `/chat/threads/:threadId` | Update thread (pin, archive, read, delivered) |
| `GET` | `/chat/threads/:threadId/messages` | Get messages (cursor paginated) |
| `POST` | `/chat/threads/:threadId/messages` | Send message |
| `GET` | `/chat/unread` | Get unread counts |
| `GET` | `/chat/messages` | Search messages (`?orgId=`, `?q=`) |
| `POST` | `/chat/threads/:threadId/actions` | Perform rich action (create trip, request payment, etc.) |

> **Major changes:**
> 1. **Unified PATCH for thread state** — Pin, archive, mark-read, mark-delivered all become:
>    - `PATCH /chat/threads/:id { "isPinned": true }`
>    - `PATCH /chat/threads/:id { "isArchived": false }`
>    - `PATCH /chat/threads/:id { "readUpTo": "messageId" }`
>    - `PATCH /chat/threads/:id { "deliveredUpTo": "messageId" }`
> 2. **Search** — `GET /chat/search` → `GET /chat/messages?q=` (searching is filtering messages).
> 3. **Actions** — kept as `POST .../actions` (plural) since these are genuinely RPC — they create side effects across multiple resources (trips, payments, invoices). This is the one deliberate exception to "no verbs".

---

### 1.11 Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/files/presigned-urls` | Request presigned upload URL |
| `POST` | `/files/uploads` | Upload with server-side compression |
| `POST` | `/files/:fileId/confirm` | Confirm upload completion |
| `GET` | `/files/:fileId` | Get file metadata |
| `GET` | `/files/:fileId/download-url` | Get presigned download URL |
| `DELETE` | `/files/:fileId` | Delete file |

> **Minor:** Resource pluralization (`presigned-url` → `presigned-urls`, `upload-compressed` → `uploads`).

---

### 1.12 Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |

No changes.

---

## 2. Migration Mapping (v2 → v3)

### Auth
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /auth/verify-widget-token` | `POST /auth/tokens` | Semantic: creating a session |
| `POST /auth/refresh` | `POST /auth/tokens/refresh` | Nested under tokens |
| `POST /auth/logout` | `DELETE /auth/tokens` | Semantic: destroying session |
| `POST /auth/register` | `POST /auth/register` | No change |
| `GET /auth/widget-config` | `GET /auth/widget-config` | No change |

### Users
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /users/me/gstin` | `PUT /users/me/gstin` | Idempotent upsert |
| `GET /users/me/gstin` | `GET /users/me/gstin` | No change |

### Orgs
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `GET /orgs/search?query=x` | `GET /orgs?search=x` | Search is filtering |
| `POST /orgs` | `POST /orgs` | No change |
| `GET /orgs` | `GET /orgs` | No change |
| `GET /orgs/:orgId` | `GET /orgs/:orgId` | No change |
| `PATCH /orgs/:orgId` | `PATCH /orgs/:orgId` | No change |
| `DELETE /orgs/:orgId` | `DELETE /orgs/:orgId` | No change |

### Items
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /items/:orgId` | `POST /orgs/:orgId/items` | Proper nesting |
| `GET /items/:orgId` | `GET /orgs/:orgId/items` | Proper nesting |
| `GET /items/:orgId/categories` | `GET /orgs/:orgId/items/categories` | Proper nesting |
| `GET /items/:orgId/:itemId` | `GET /orgs/:orgId/items/:itemId` | Proper nesting |
| `PATCH /items/:orgId/:itemId` | `PATCH /orgs/:orgId/items/:itemId` | Proper nesting |
| `DELETE /items/:orgId/:itemId` | `DELETE /orgs/:orgId/items/:itemId` | Proper nesting |

### Trucks
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /trucks` | `POST /orgs/:orgId/trucks` | Under org |
| `GET /trucks?orgId=x` | `GET /orgs/:orgId/trucks` | Under org |
| `GET /trucks/:truckId` | `GET /orgs/:orgId/trucks/:truckId` | Under org |
| `PATCH /trucks/:truckId` | `PATCH /orgs/:orgId/trucks/:truckId` | Under org |
| `DELETE /trucks/:truckId` | `DELETE /orgs/:orgId/trucks/:truckId` | Under org |

### Drivers
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `GET /drivers/search?phone=x` | `GET /drivers?phone=x` | Merged into list |
| `GET /tracking/drivers/:id/active-trips` | `GET /drivers/:id/trips?status=ACTIVE` | Under driver |
| `POST /drivers` | `POST /drivers` | No change |
| `GET /drivers` | `GET /drivers` | No change |
| `GET /drivers/:id` | `GET /drivers/:id` | No change |
| `PATCH /drivers/:id` | `PATCH /drivers/:id` | No change |
| `DELETE /drivers/:id` | `DELETE /drivers/:id` | No change |

### Trips
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `PATCH /trips/:id/status` | `PATCH /trips/:id` | Unified into single PATCH |
| `POST /trips/:id/cancel` | `PATCH /trips/:id` | `{ "status": "CANCELLED" }` |
| `POST /trips/:id/change-driver` | `PATCH /trips/:id` | `{ "driverPhone": "..." }` |
| `GET /tracking/trips/:id/locations` | `GET /trips/:id/locations` | Under trips |
| `GET /tracking/trips/:id/latest` | `GET /trips/:id/locations/latest` | Under trips |
| `POST /tracking/ping` | `POST /trips/:id/locations` | Under trips |
| `POST /trips/:id/driver-payment` | `PUT /trips/:id/driver-payment` | Idempotent upsert |
| `POST .../driver-payment/record` | `POST .../driver-payment/records` | Plural resource |
| `GET /orgs/:id/pending-driver-payments` | `GET /orgs/:id/driver-payments?status=PENDING` | Filter, not separate endpoint |
| `POST /trips` | `POST /trips` | No change |
| `GET /trips` | `GET /trips` | No change |
| `GET /trips/:id` | `GET /trips/:id` | No change |
| `POST /trips/:id/load-card` | `POST /trips/:id/load-card` | No change |
| `POST /trips/:id/receive-card` | `POST /trips/:id/receive-card` | No change |

### Ledger
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /ledger/accounts` | `POST /accounts` | Top-level resource |
| `GET /ledger/accounts` | `GET /accounts` | Top-level resource |
| `GET /ledger/accounts/:id` | `GET /accounts/:id` | Top-level resource |
| `GET /ledger/accounts/:id/timeline` | `GET /accounts/:id/entries` | "entries" is the data model name |
| `POST /ledger/invoices` | `POST /invoices` | Top-level resource |
| `PATCH /ledger/invoices/:id` | `PATCH /invoices/:id` | Top-level resource |
| `GET /ledger/accounts/:id/invoices` | `GET /accounts/:id/invoices` | Under accounts |
| `POST /ledger/payments` | `POST /payments` | Top-level resource |
| `POST /ledger/payments/request` | `POST /payments/requests` | Plural |
| `POST /ledger/payments/mark-paid` | `PATCH /payments/:id` | Unified status update |
| `POST /ledger/payments/confirm` | `PATCH /payments/:id` | Unified status update |
| `POST /ledger/payments/dispute` | `PATCH /payments/:id` | Unified status update |
| `GET /ledger/accounts/:id/payments` | `GET /accounts/:id/payments` | Under accounts |
| `GET /ledger/accounts/:id/pending-payments` | `GET /accounts/:id/payments?status=PENDING` | Filter |
| `GET /ledger/payments/:id` | `GET /payments/:id` | Top-level resource |

### Chat
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /chat/threads/:id/read` | `PATCH /chat/threads/:id` | `{ "readUpTo": "msgId" }` |
| `POST /chat/threads/:id/delivered` | `PATCH /chat/threads/:id` | `{ "deliveredUpTo": "msgId" }` |
| `POST /chat/threads/:id/pin` | `PATCH /chat/threads/:id` | `{ "isPinned": true }` |
| `POST /chat/threads/:id/archive` | `PATCH /chat/threads/:id` | `{ "isArchived": true }` |
| `GET /chat/search?orgId=x&query=y` | `GET /chat/messages?orgId=x&q=y` | Search is filtering messages |
| `POST /chat/threads/:id/action` | `POST /chat/threads/:id/actions` | Plural (no change otherwise) |
| `POST /chat/threads` | `POST /chat/threads` | No change |
| `GET /chat/threads` | `GET /chat/threads` | No change |
| `GET /chat/threads/:id` | `GET /chat/threads/:id` | No change |
| `GET /chat/threads/:id/messages` | `GET /chat/threads/:id/messages` | No change |
| `POST /chat/threads/:id/messages` | `POST /chat/threads/:id/messages` | No change |
| `GET /chat/unread` | `GET /chat/unread` | No change |

### Files
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /files/presigned-url` | `POST /files/presigned-urls` | Plural |
| `POST /files/upload-compressed` | `POST /files/uploads` | Cleaner name |
| `POST /files/confirm-upload` | `POST /files/:fileId/confirm` | Resource-scoped |
| `GET /files/:id` | `GET /files/:id` | No change |
| `GET /files/:id/download-url` | `GET /files/:id/download-url` | No change |
| `DELETE /files/:id` | `DELETE /files/:id` | No change |

### Exports
| v2 Endpoint | v3 Endpoint | Notes |
|---|---|---|
| `POST /exports/:orgId` | `POST /orgs/:orgId/exports` | Under org |
| `GET /exports/:orgId/history` | `GET /orgs/:orgId/exports` | List IS the history |

---

## 3. API Conventions

### 3.1 Cursor Pagination

All list endpoints return cursor-based pagination:

```json
// Request
GET /trips?orgId=xxx&limit=20&cursor=eyJpZCI6ImNseDEyMzQifQ

// Response
{
  "success": true,
  "data": [...],
  "pagination": {
    "limit": 20,
    "hasMore": true,
    "nextCursor": "eyJpZCI6ImNseDU2NzgifQ",
    "prevCursor": "eyJpZCI6ImNseDAwMDEifQ"
  }
}
```

**Cursor encoding:** Base64-encoded JSON `{ "id": "cuid", "createdAt": "ISO" }`. Opaque to clients.

**Applies to:** trips, chat messages, chat threads, ledger entries, payments, invoices, drivers, items, exports.

**First request:** Omit `cursor` param. Sorting defaults to `createdAt DESC`.

---

### 3.2 Error Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [
      { "field": "amount", "message": "Must be a positive integer" }
    ],
    "requestId": "req_abc123"
  }
}
```

**Standard error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad request body/params |
| `UNAUTHORIZED` | 401 | Missing/invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate / state conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `IDEMPOTENCY_CONFLICT` | 409 | Idempotency key reused with different body |

---

### 3.3 Timestamps

All timestamps are **ISO 8601 in UTC**:

```
"2026-02-23T12:00:00.000Z"
```

No Unix timestamps. No timezone offsets in responses.

---

### 3.4 Idempotency

All `POST` endpoints that create resources support the `Idempotency-Key` header:

```http
POST /trips
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{ "sourceOrgId": "...", ... }
```

**Rules:**
1. Key is a client-generated UUID v4
2. Server stores `(key, userId, endpoint, responseStatus, responseBody)` in Redis with 24h TTL
3. If same key + same endpoint is received again → return cached response (no side effects)
4. If same key + different body → return `409 IDEMPOTENCY_CONFLICT`
5. `GET`, `PATCH`, `DELETE` do not need idempotency keys (idempotent by definition)

**Required on:**
- `POST /trips`
- `POST /payments`
- `POST /payments/requests`
- `POST /invoices`
- `POST /chat/threads/:id/messages` (uses existing `clientMessageId` internally)

---

### 3.5 Filtering Pattern

Filters are always query parameters on the list endpoint:

```
GET /trips?orgId=xxx&status=IN_TRANSIT&limit=20
GET /drivers?phone=+919876543210
GET /orgs?search=kumar
GET /accounts/:id/payments?status=PENDING
GET /drivers/:id/trips?status=ACTIVE
```

**No separate `/search`, `/pending-*`, `/active-*` endpoints.**

---

### 3.6 Response Envelope

All responses follow:

```json
// Success
{
  "success": true,
  "data": { ... },              // Single resource
  "pagination": { ... }         // Only on list endpoints
}

// Success (list)
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "limit": 20,
    "hasMore": true,
    "nextCursor": "..."
  }
}
```

---

## 4. Chat System Contract

### 4.1 Architecture: One Thread Per Org Pair

```
┌──────────────────────┐       ┌──────────────────────┐
│  Mahajan Fruits       │       │  Shaikh Trading       │
│  (Nashik)             │◄─────►│  (Vashi/Mumbai)       │
│  orgId: cm1...        │       │  orgId: cm2...        │
└──────────────────────┘       └──────────────────────┘
            │
            ▼
   ┌─────────────────────────────────────┐
   │  ChatThread (ONE per org pair)      │
   │  orgId: min(cm1, cm2)              │
   │  counterpartyOrgId: max(cm1, cm2)  │
   │  @@unique([orgId, counterpartyOrgId]) │
   └──────────┬──────────────────────────┘
              │
              ▼
   Messages (mixed in single thread):
   ┌─────────────────────────────────────┐
   │ TEXT     "Javed bhai, tamatar ready" │
   │ TEXT     "Bhav kya hai?"            │
   │ TEXT     "₹1200 per crate"          │
   │ SYSTEM   🚚 Trip created            │  ← tripId: trip_abc
   │ TEXT     "Driver nikal gaya"         │  ← tripId: trip_abc
   │ TRIP_CARD  Trip #abc details        │  ← tripId: trip_abc
   │ SYSTEM   ✅ Delivered               │  ← tripId: trip_abc
   │ PAYMENT  💰 ₹3,65,000 requested    │
   │ TEXT     "Payment bhej deta hoon"   │
   │ PAYMENT  ✅ Payment confirmed       │
   │ SYSTEM   🚚 New trip created        │  ← tripId: trip_xyz
   └─────────────────────────────────────┘
```

### 4.2 Thread Creation

```http
POST /chat/threads
{
  "counterpartyOrgId": "cm2..."   // Primary
}
```

Server normalizes: `orgId = min(userOrg, counterparty)`, `counterpartyOrgId = max(...)`.  
Returns existing thread if one already exists for this org pair.

Alternative resolvers (convenience):
- `{ "accountId": "..." }` — resolves org pair from Account's ownerOrg/counterpartyOrg
- `{ "tripId": "..." }` — resolves org pair from Trip's sourceOrg/destinationOrg

All three resolve to the **same thread** if the org pair matches.

### 4.3 Message Types

| messageType | Purpose | tripId? |
|---|---|---|
| `TEXT` | User text message | Optional |
| `IMAGE` | Photo attachment | Optional |
| `PDF` | Document | Optional |
| `FILE` | Generic file | Optional |
| `AUDIO` | Voice note | Optional |
| `SYSTEM_MESSAGE` | Auto-generated status updates | Usually yes |
| `TRIP_CARD` | Rich trip summary card | Always yes |
| `PAYMENT_UPDATE` | Payment status change | No |
| `PAYMENT_REQUEST` | Payment request card | No |
| `INVOICE_CARD` | Invoice summary card | No |
| `DATA_GRID` | Tabular data share | No |

### 4.4 Trip Context on Messages

Any message can optionally include `tripId` to associate it with a specific trip:

```http
POST /chat/threads/:threadId/messages
{
  "content": "Driver nikal gaya bhai",
  "messageType": "TEXT",
  "tripId": "trip_abc123"    // ← this message is about trip_abc123
}
```

Frontend can use `tripId` to:
- Group messages by trip in a filtered view
- Show a trip badge/chip on the message
- Link to trip details

### 4.5 System Messages

System messages are auto-generated by the backend when:
- Trip status changes (CREATED, IN_TRANSIT, DELIVERED, etc.)
- Payment events (requested, paid, confirmed, disputed)
- Invoice created
- Driver/truck changed

These are inserted into the org-pair chat thread with `senderUserId: null` and the appropriate `messageType`.

### 4.6 Key Invariant

> **There is NO `tripId` on `ChatThread`.** Trips do **not** create separate threads.  
> Trip context lives on **individual messages** via `ChatMessage.tripId`.

---

## 5. Implementation Strategy

### Phase 1: Dual-mount (v2 + v3 side by side) — Zero breaking changes
1. Create v3 route files that call the **same controllers/services**
2. Mount both `/api/v1` (old) and `/api/v3` (new) in `app.ts`
3. Add deprecation headers to v2: `Deprecation: true`, `Sunset: 2026-06-01`
4. Frontend/mobile teams migrate to v3 at their pace

### Phase 2: Controller refactoring
1. Merge `cancelTrip` + `updateTripStatus` + `changeTripDriver` + `editTrip` into one `updateTrip` handler
2. Merge payment status endpoints into one `updatePayment` handler
3. Merge chat thread state endpoints into one `updateThread` handler
4. Add cursor pagination to all list methods
5. Add idempotency middleware

### Phase 3: Retire v2
1. Monitor v2 traffic → when zero, remove v2 routes
2. Update all documentation to v3 only

### No-change items (explicitly preserved)
- All Prisma schema/models
- All service-layer business logic
- Socket.IO event names and payloads
- Redis pub/sub channels
- File upload/compression pipeline
- Auth token lifecycle

---

*End of REST v3 Refactoring Plan*
