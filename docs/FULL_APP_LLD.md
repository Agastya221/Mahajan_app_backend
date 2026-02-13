# Mahajan Network Platform — Full Application LLD

> **Version:** 2.0  
> **Last Updated:** 2026-02-13  
> **Stack:** Node.js · Express · TypeScript · Prisma · PostgreSQL · Redis · Socket.IO · AWS S3 · BullMQ

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Database Schema (Full ERD)](#3-database-schema-full-erd)
4. [Module Breakdown](#4-module-breakdown)
   - 4.1 [Auth Module](#41-auth-module)
   - 4.2 [Organization Module](#42-organization-module)
   - 4.3 [User Module](#43-user-module)
   - 4.4 [Driver Module](#44-driver-module)
   - 4.5 [Truck Module](#45-truck-module)
   - 4.6 [Item Master Module](#46-item-master-module)
   - 4.7 [Trip Module](#47-trip-module)
   - 4.8 [Tracking Module](#48-tracking-module)
   - 4.9 [Ledger (Khata) Module](#49-ledger-khata-module)
   - 4.10 [Chat Module](#410-chat-module)
   - 4.11 [File Management Module](#411-file-management-module)
   - 4.12 [Export Module](#412-export-module)
   - 4.13 [Driver Payment Module](#413-driver-payment-module)
   - 4.14 [Notification Module](#414-notification-module)
5. [Middleware & Security](#5-middleware--security)
6. [Real-Time Architecture (WebSocket)](#6-real-time-architecture-websocket)
7. [Infrastructure & Config](#7-infrastructure--config)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Caching Strategy](#9-caching-strategy)
10. [Key Business Flows (Sequence Diagrams)](#10-key-business-flows)
11. [Frontend Integration Guide](#11-frontend-integration-guide)

---

## 1. System Overview

**Mahajan Network Platform** is a B2B logistics & financial management platform for the Indian agricultural supply chain. It connects **Source Mahajans** (collectors at mandis) with **Destination Mahajans** (city distributors) via truck-based shipments.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Mahajan** | A trader (user with role `MAHAJAN`) who owns an `Org` |
| **Org** | Business entity — each mahajan is the sole owner of their org |
| **Driver** | Independent user (role `DRIVER`) with a `DriverProfile`; not bound to any org |
| **Trip** | A shipment from Source Org → Destination Org via a Truck driven by a Driver |
| **Load Card** | What was loaded at source (multi-item, with quantities and rates) |
| **Receive Card** | What was received at destination (with item-wise shortage calculation) |
| **Account (Khata)** | Financial relationship between two Orgs — tracks balance (₹) |
| **Payment** | GPay-like two-party confirmation flow: Request → Mark Paid → Confirm/Dispute |
| **Invoice** | Formal bill linked to an Account, optionally tied to a Trip |
| **Chat Thread** | WhatsApp-like messaging tied to an Account or Trip |

### Tech Stack

```
┌──────────────────────────────────────────────┐
│                  CLIENT APPS                  │
│   React Native (Mobile) · Web Dashboard       │
└──────────────┬───────────────────┬────────────┘
               │ REST API          │ WebSocket
               ▼                   ▼
┌──────────────────────────────────────────────┐
│              EXPRESS SERVER (app.ts)           │
│  Helmet · CORS · Rate Limiting · Body Parser  │
├──────────────────────────────────────────────┤
│   Middleware: authenticate · requireRole       │
│              requireOrgMember · errorHandler   │
├──────────────────────────────────────────────┤
│   14 Modules (Controller → Service → Prisma)  │
├──────────────────────────────────────────────┤
│   Socket.IO Gateway (socket.gateway.ts)       │
│   Redis Pub/Sub for cross-instance messaging  │
├─────────┬────────────┬───────────┬───────────┤
│ Prisma  │   Redis    │  AWS S3   │  BullMQ   │
│ (ORM)   │  (Cache/   │  (Files)  │  (Queues) │
│         │   PubSub)  │           │           │
└────┬────┴─────┬──────┴─────┬─────┴─────┬─────┘
     ▼          ▼            ▼           ▼
 PostgreSQL   Redis       S3/MinIO    Redis
```

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway: /api/v1                      │
├──────────┬──────────┬──────────┬──────────┬──────────────────┤
│  /auth   │  /orgs   │  /trips  │  /chat   │  /ledger         │
│  /drivers│  /trucks │ /tracking│  /items  │  /files           │
│  /exports│  /users  │          │          │  /driver-payments  │
└──────────┴──────────┴──────────┴──────────┴──────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        Controllers   Middleware   WebSocket
              │                    Gateway
              ▼
          Services ──────────────► Redis Pub/Sub
              │                        │
              ▼                        ▼
         Prisma ORM              Socket.IO
              │                   (Rooms)
              ▼
         PostgreSQL
```

---

## 3. Database Schema (Full ERD)

### 3.1 Enums

```prisma
enum UserRole        { MAHAJAN, DRIVER }
enum MahajanRoleType { SOURCE_COLLECTOR, DESTINATION_DISTRIBUTOR, BOTH }
enum TripStatus      { CREATED, ASSIGNED, LOADED, IN_TRANSIT, ARRIVED,
                       REACHED, DELIVERED, COMPLETED, CLOSED, CANCELLED, DISPUTED }
enum TripEventType   { TRIP_CREATED, ASSIGNED, LOAD_COMPLETED, IN_TRANSIT,
                       ARRIVED, DELIVERED, TRIP_COMPLETED, POD_UPLOADED,
                       PAYMENT_RECORDED, DISPUTE_RAISED, DISPUTE_RESOLVED,
                       TRIP_CANCELLED, CLOSED, NOTE }
enum QuantityUnit    { KG, BAG, TON, CRATE, BOX, BUNDLE, TRAY, SACK,
                       PETI, DOZEN, PIECE, QUINTAL, OTHER }
enum PaymentTag      { ADVANCE, PARTIAL, FINAL, DUE, OTHER }
enum PaymentStatus   { PENDING, MARKED_AS_PAID, CONFIRMED, DISPUTED, CANCELLED }
enum AttachmentType  { LOAD_PHOTO, RECEIVE_PHOTO, PAYMENT_PROOF, INVOICE,
                       RECEIPT, CHAT_IMAGE, CHAT_DOCUMENT, OTHER }
enum ChatMessageType { TEXT, IMAGE, PDF, FILE, SYSTEM_MESSAGE, PAYMENT_UPDATE,
                       INVOICE_UPDATE, LOCATION, TRIP_CARD, PAYMENT_REQUEST,
                       INVOICE_CARD, DATA_GRID }
enum LedgerDirection { PAYABLE, RECEIVABLE }
enum DriverPaymentPaidBy   { SOURCE, DESTINATION, SPLIT }
enum DriverPaymentStatus   { PENDING, PARTIALLY_PAID, PAID, DISPUTED }
```

### 3.2 Entity Relationship Summary

```
User ──1:N──► OrgMember ◄──N:1── Org
User ──1:1──► DriverProfile
Org  ──1:N──► Truck
Org  ──1:N──► Item
Org  ──1:N──► ExportLog
Org  ──1:N──► ChatThread
Org  ──1:N──► Account (as owner or counterparty)

Trip ──N:1──► Org (sourceOrg, destinationOrg)
Trip ──N:1──► Truck
Trip ──N:1──► DriverProfile
Trip ──1:1──► TripLoadCard ──1:N──► LoadItem ──N:1──► Item
Trip ──1:1──► TripReceiveCard ──1:N──► ReceiveItem ──N:1──► Item
Trip ──1:N──► TripEvent
Trip ──1:N──► TripLocation
Trip ──1:1──► TripLatestLocation
Trip ──1:N──► Payment, Invoice, LedgerEntry, Dispute
Trip ──1:N──► ChatThread
Trip ──1:1──► DriverPayment

Account ──N:1──► Org (owner, counterparty)
Account ──1:N──► LedgerEntry, Invoice, Payment, ChatThread

ChatThread ──1:N──► ChatMessage
ChatMessage ──N:1──► Payment, Invoice, LedgerEntry (optional FKs)
ChatMessage ──1:N──► Attachment

LoadItem ──1:1──► ReceiveItem (for shortage calculation)
```

### 3.3 Key Models (Fields)

#### User
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| role | UserRole | MAHAJAN or DRIVER |
| name | String | |
| phone | String | unique |
| passwordHash | String? | Optional (OTP-only users) |
| gstin | String? | unique, optional GST number |
| isVerified | Boolean | True when GST verified (badge) |
| status | String | ACTIVE / SUSPENDED / BANNED |

#### Org
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| name | String | Business name |
| city, phone, address | String? | |
| gstin | String? | unique org GST |
| roleType | MahajanRoleType | SOURCE / DESTINATION / BOTH |

#### Trip
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| sourceOrgId, destinationOrgId | FK → Org | |
| truckId | FK → Truck | |
| driverId | FK → DriverProfile? | |
| pendingDriverPhone | String? | For drivers not yet registered |
| startPoint, endPoint | String? | Location names |
| status | TripStatus | State machine |
| notes | String? | |

#### Account (Khata)
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| ownerOrgId | FK → Org | The org that created the account |
| counterpartyOrgId | FK → Org | The other party |
| balance | BigInt | Running balance in paisa (default 0) |
| | | @@unique([ownerOrgId, counterpartyOrgId]) |

#### Payment
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| accountId | FK → Account? | |
| amount | BigInt | In paisa |
| status | PaymentStatus | State machine |
| mode | String? | UPI, BANK_TRANSFER, CASH, CHEQUE |
| tag | PaymentTag? | ADVANCE, PARTIAL, FINAL, DUE |
| markedPaidAt/By | DateTime?/FK | When sender marks paid |
| utrNumber | String? | UTR/Transaction reference |
| confirmedAt/By | DateTime?/FK | When receiver confirms |
| disputedAt/By | DateTime?/FK | When receiver disputes |
| disputeReason | String? | |

#### ChatThread
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| orgId | FK → Org | |
| accountId | FK → Account? | @@unique — one thread per account |
| tripId | FK → Trip? | @@unique — one thread per trip |
| type | String | GENERAL (default) |
| isPinned, isArchived | Boolean | WhatsApp-like features |
| unreadCount | Int | Per-thread unread |

#### ChatMessage
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| threadId | FK → ChatThread | |
| senderUserId | FK → User? | null for system messages |
| content | String? | Text content |
| messageType | ChatMessageType | TEXT, TRIP_CARD, PAYMENT_REQUEST, etc. |
| metadata | Json? | Structured data for rich cards |
| paymentId, invoiceId, ledgerEntryId | FK? | Links to business entities |
| isRead, isDelivered | Boolean | Read receipts |
| replyToId | FK → ChatMessage? | Reply threading |

---

## 4. Module Breakdown

### 4.1 Auth Module

**Purpose:** OTP-based authentication via MSG91 widget, JWT token management.

**Flow:** MSG91 OTP Widget → Widget Access Token → Backend Verification → JWT Pair

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/auth/widget-config` | GET | Public | Get MSG91 widgetId + tokenAuth |
| `/auth/verify-widget-token` | POST | Public | Verify OTP token → login or register prompt |
| `/auth/register` | POST | Public | Complete registration (needs verificationToken) |
| `/auth/refresh` | POST | Public | Rotate refresh token → new access + refresh |
| `/auth/logout` | POST | Private | Blacklist access token + revoke refresh |

**Service Methods:**
- `verifyWidgetToken(token)` — Calls MSG91 API, returns user or `{ isNewUser, verificationToken }`
- `register(data)` — Creates User + DriverProfile (if DRIVER), links pending trips
- `refreshToken(token)` — Token family rotation with breach detection
- `logout(accessToken, refreshToken)` — Redis blacklist (TTL = token expiry) + DB revoke
- `linkPendingDriverTrips(phone, profileId)` — Auto-assigns trips created with `pendingDriverPhone`
- `isTokenBlacklisted(token)` — Checks Redis key `blacklist:${token}`

**Token Structure:**
```json
// Access Token (15min default)
{ "userId": "...", "phone": "...", "role": "MAHAJAN", "type": "access" }

// Refresh Token — opaque hex stored in DB (RefreshToken model)
// 30-day expiry, family-based rotation
```

---

### 4.2 Organization Module

**Purpose:** CRUD for business entities (Orgs). Each mahajan is sole owner.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/orgs` | POST | Private | Create org (auto-adds creator as member) |
| `/orgs` | GET | Private | Get user's orgs |
| `/orgs/search` | GET | Private | Search by name/phone/owner (cached 5min) |
| `/orgs/:orgId` | GET | Private + OrgMember | Get org details |
| `/orgs/:orgId` | PATCH | Private | Update org (owner only) |
| `/orgs/:orgId` | DELETE | Private | Delete org (owner only) |

**Search:** Queries Org name, phone, AND member User name/phone. Results cached in Redis (`search:org:${query}`, 5min TTL).

---

### 4.3 User Module

**Purpose:** GST verification workflow for Mahajans.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/users/me/gstin` | POST | Private | Submit GSTIN (MAHAJAN only) |
| `/users/me/gstin` | GET | Private | Get verification status |

**Flow:** Submit GSTIN → `isVerified: false` → Admin/system verifies → `isVerified: true` (badge shown)

---

### 4.4 Driver Module

**Purpose:** Manage independent driver profiles (not org-bound).

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/drivers` | POST | Private | Create driver profile |
| `/drivers` | GET | Private | List drivers (filter by phone) |
| `/drivers/:driverId` | GET | Private | Get driver + active trips |
| `/drivers/:driverId` | PATCH | Private | Update profile |
| `/drivers/:driverId` | DELETE | Private | Delete (blocked if active trips) |

**Caching:** List cached 30min, detail cached 1hr. Cache invalidated on create/update/delete.

---

### 4.5 Truck Module

**Purpose:** Manage trucks owned by Orgs. Truck numbers globally unique.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/trucks` | POST | Private | Create truck (org member only) |
| `/trucks` | GET | Private | List trucks (filter by orgId) |
| `/trucks/:truckId` | GET | Private | Get truck + recent trips |
| `/trucks/:truckId` | PATCH | Private | Update (org member only) |
| `/trucks/:truckId` | DELETE | Private | Delete (blocked if active trips) |

---

### 4.6 Item Master Module

**Purpose:** Flexible item catalog per org (e.g., "Kinnaur Apple", "Potato Local").

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/items/:orgId` | POST | OrgMember | Create item |
| `/items/:orgId` | GET | OrgMember | List items (org + global, search/filter) |
| `/items/:orgId/categories` | GET | OrgMember | Distinct categories |
| `/items/:orgId/:itemId` | GET | OrgMember | Get item by ID |
| `/items/:orgId/:itemId` | PATCH | OrgMember | Update item |
| `/items/:orgId/:itemId` | DELETE | OrgMember | Soft-delete (isActive=false) |

**Key:** Items with `orgId: null` are global/shared items visible to all orgs.

---

### 4.7 Trip Module

**Purpose:** Core logistics — create trips, manage lifecycle, load/receive cards with multi-item support.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/trips` | POST | Private | Create trip |
| `/trips` | GET | Private | List trips (filter by org, status) |
| `/trips/:tripId` | GET | Private | Get trip with full details |
| `/trips/:tripId/status` | PATCH | Private | Update status (state machine) |
| `/trips/:tripId/load-card` | POST | Private | Create load card (source mahajan) |
| `/trips/:tripId/receive-card` | POST | Private | Create receive card (dest mahajan) |

#### Trip Status State Machine

```
CREATED → ASSIGNED → LOADED → IN_TRANSIT → ARRIVED → REACHED → DELIVERED → COMPLETED → CLOSED
                                                                    ↘ DISPUTED
                                                     CANCELLED ←──── (from most states)
```

#### Load Card Creation Flow
1. Validate trip exists and user is source org member
2. Create `TripLoadCard` with summary fields
3. Create `LoadItem[]` — each with itemName, quantity, unit, rate, amount
4. Auto-calculate `totalItems`, `totalQuantity`, `totalAmount`
5. Update trip status to `LOADED`
6. Create `TripEvent` (LOAD_COMPLETED)
7. Post `TRIP_CARD` to chat thread (non-blocking)

#### Receive Card & Shortage Calculation
1. Validate trip exists and user is destination org member
2. For each `ReceiveItem`, link to corresponding `LoadItem`
3. Calculate: `shortage = loadItem.quantity - receiveItem.quantity`
4. Calculate: `shortagePercent = (shortage / loadItem.quantity) × 100`
5. Auto-calculate summary: `totalShortage`, `shortagePercent`
6. Update trip status to `DELIVERED`
7. Post `LOAD_CARD` (shortage alert) to chat if shortage > 0

---

### 4.8 Tracking Module

**Purpose:** Real-time GPS tracking of trucks during trips.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/tracking/ping` | POST | Driver only | Submit batched GPS pings |
| `/tracking/trips/:tripId/locations` | GET | Private | Location history |
| `/tracking/trips/:tripId/latest` | GET | Private | Latest location |
| `/tracking/drivers/:driverId/active-trips` | GET | Driver only | Active trips for driver |

#### Optimizations (Production-Grade)
1. **Trip Metadata Cache** — Redis cache for trip validation (99% query reduction: 750→12 queries/min)
2. **Location Throttle** — Store only 1 location per 30s per trip in PostgreSQL (Redis-based dedup)
3. **Batch Processing** — Locations queued via BullMQ `location-batch.queue`, processed in batches
4. **Real-time Broadcast** — Every ping published to Redis → Socket.IO room `trip:${tripId}`
5. **Latest Location Table** — `TripLatestLocation` upserted on every ping for O(1) lookups

#### Rate Limiting
- 10 batch uploads per minute per IP (dedicated tracking limiter)

---

### 4.9 Ledger (Khata) Module

**Purpose:** Full financial ledger between Orgs — accounts, invoices, payments with two-party confirmation.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/ledger/accounts` | POST | Private | Create/get account between 2 orgs |
| `/ledger/accounts` | GET | Private | List accounts for org |
| `/ledger/accounts/:id` | GET | Private | Account detail |
| `/ledger/accounts/:id/timeline` | GET | Private | Ledger entries timeline |
| `/ledger/invoices` | POST | Private | Create invoice |
| `/ledger/accounts/:id/invoices` | GET | Private | List invoices |
| `/ledger/invoices/:id` | PATCH | Private | Update invoice |
| `/ledger/payments` | POST | Private | Record payment (legacy/direct) |
| `/ledger/accounts/:id/payments` | GET | Private | List payments |
| `/ledger/payments/request` | POST | Private | Create payment request |
| `/ledger/payments/mark-paid` | POST | Private | Mark as paid |
| `/ledger/payments/confirm` | POST | Private | Confirm payment |
| `/ledger/payments/dispute` | POST | Private | Dispute payment |
| `/ledger/accounts/:id/pending-payments` | GET | Private | Pending payments |
| `/ledger/payments/:id` | GET | Private | Payment detail |

#### Payment State Machine (GPay-like)

```
         Receiver creates
              │
              ▼
     ┌──── PENDING ────┐
     │                  │
     │  Sender marks    │  Cancelled
     │  as paid         │
     ▼                  ▼
 MARKED_AS_PAID    CANCELLED
     │
     ├── Receiver confirms ──► CONFIRMED ──► Ledger updated, balance adjusted
     │
     └── Receiver disputes ──► DISPUTED ──► No ledger change
```

**Critical Rule:** `Account.balance` is ONLY updated when payment reaches `CONFIRMED` status, never before.

#### Invoice Creation
1. Auto-generate `invoiceNumber` (e.g., `INV-001`)
2. Create `LedgerEntry` (direction: RECEIVABLE, amount = invoice total)
3. Update `Account.balance`
4. Post `INVOICE_CARD` to account chat thread

---

### 4.10 Chat Module

**Purpose:** WhatsApp-like real-time messaging with rich interactive cards.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/chat/threads` | POST | Private | Create/get thread |
| `/chat/threads` | GET | Private | List threads |
| `/chat/threads/:id` | GET | Private | Thread detail |
| `/chat/threads/:id/messages` | GET | Private | Messages (paginated) |
| `/chat/threads/:id/messages` | POST | Private | Send message |
| `/chat/threads/:id/read` | POST | Private | Mark as read |
| `/chat/threads/:id/delivered` | POST | Private | Mark as delivered |
| `/chat/threads/:id/pin` | POST | Private | Pin/unpin |
| `/chat/threads/:id/archive` | POST | Private | Archive/unarchive |
| `/chat/unread` | GET | Private | Unread counts |
| `/chat/search` | GET | Private | Search messages |
| `/chat/threads/:id/action` | POST | Private | Perform rich action |

#### Thread Types
- **Account Thread** — `@@unique(accountId)` — one thread per financial relationship
- **Trip Thread** — `@@unique(tripId)` — one thread per trip

#### Rich Card Types (via `messageType` + `metadata`)

| messageType | Triggered By | metadata Shape |
|-------------|-------------|----------------|
| `TRIP_CARD` | Trip creation / load card | `{ tripId, status, items[], route }` |
| `PAYMENT_REQUEST` | Payment lifecycle | `{ paymentId, amount, status, action, mode }` |
| `INVOICE_CARD` | Invoice creation | `{ invoiceId, invoiceNumber, total, dueDate }` |
| `DATA_GRID` | Share ledger/data | `{ title, columns[], rows[] }` |
| `SYSTEM_MESSAGE` | Auto-generated events | `{ type, ... }` |

#### Chat Action Endpoint (`/action`)
Unified router — dispatches to the correct service:

| actionType | Service Called | Chat Card Posted |
|------------|---------------|------------------|
| `CREATE_TRIP` | TripService.createTrip | TRIP_CARD |
| `REQUEST_PAYMENT` | LedgerService.createPaymentRequest | PAYMENT_REQUEST |
| `MARK_PAYMENT_PAID` | LedgerService.markPaymentAsPaid | PAYMENT_REQUEST |
| `CONFIRM_PAYMENT` | LedgerService.confirmPayment | PAYMENT_REQUEST |
| `DISPUTE_PAYMENT` | LedgerService.disputePayment | PAYMENT_REQUEST |
| `CREATE_INVOICE` | LedgerService.createInvoice | INVOICE_CARD |
| `SHARE_DATA_GRID` | ChatService.sendDataGrid | DATA_GRID |
| `SHARE_LEDGER_TIMELINE` | LedgerService.getLedgerTimeline | DATA_GRID |

---

### 4.11 File Management Module

**Purpose:** S3-based file uploads with presigned URLs and server-side image compression.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/files/presigned-url` | POST | Private | Get presigned upload URL |
| `/files/confirm-upload` | POST | Private | Confirm upload completed |
| `/files/upload-compressed` | POST | Private | Upload with server-side compression |
| `/files/:fileId/download-url` | GET | Private | Get presigned download URL |
| `/files/:fileId` | GET | Private | File metadata |
| `/files/:fileId` | DELETE | Private | Delete file |

#### S3 Folder Structure
```
proofs/load/{YYYY}/{MM}/{uuid}.jpg
proofs/receive/{YYYY}/{MM}/{uuid}.jpg
proofs/payments/{YYYY}/{MM}/{uuid}.jpg
documents/invoices/{YYYY}/{MM}/{uuid}.pdf
chat/{YYYY}/{MM}/{uuid}.jpg
uploads/{YYYY}/{MM}/{uuid}.* (default)
```

#### Image Compression (Sharp)
- Max dimensions: 1920×1920 (aspect ratio preserved)
- Output: JPEG quality 80
- Target: ~300KB output

#### Allowed MIME Types
`image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

---

### 4.12 Export Module

**Purpose:** Generate Excel (XLSX) exports for trips, uploaded to S3.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/exports/:orgId` | POST | OrgMember | Generate export |
| `/exports/:orgId/history` | GET | OrgMember | Export history |

**Export includes:** Trip details, load card amounts, payment status, date range filtering. Stored in `ExportLog` model with S3 link and expiry.

---

### 4.13 Driver Payment Module

**Purpose:** Track payments to drivers — source pays, destination pays, or split.

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/trips/:tripId/driver-payment` | POST | Private | Create/update payment terms |
| `/trips/:tripId/driver-payment/record` | POST | Private | Record partial/full payment |
| `/trips/:tripId/driver-payment` | GET | Private | Get payment status |
| `/orgs/:orgId/pending-driver-payments` | GET | Private | List pending for org |

#### Split Payment
When `paidBy = SPLIT`, both `splitSourceAmount` and `splitDestAmount` must be provided and sum to `totalAmount`.

#### Status: `PENDING → PARTIALLY_PAID → PAID`

---

### 4.14 Notification Module

**Purpose:** Background notification processing via BullMQ queue.

**Queue:** `notifications` (Redis-backed via BullMQ)  
**Concurrency:** 5 jobs, rate-limited to 10/sec

| Notification Type | Triggered By |
|-------------------|-------------|
| `TRIP_CREATED` | New trip |
| `TRIP_STATUS_CHANGED` | Status update |
| `LOAD_CARD_CREATED` | Load card submitted |
| `RECEIVE_CARD_CREATED` | Receive card submitted |
| `PAYMENT_RECEIVED` | Payment confirmed |
| `INVOICE_CREATED` | Invoice created |
| `CHAT_MESSAGE` | New chat message |

> **Note:** Push notification handlers are currently placeholder implementations (TODO: Firebase/SNS integration).

---

## 5. Middleware & Security

### 5.1 Authentication Middleware (`authenticate`)
1. Extract Bearer token from `Authorization` header
2. Check Redis blacklist (`blacklist:${token}`)
3. Verify JWT with `accessSecret`
4. Verify `type === 'access'` (not refresh)
5. Verify user exists in DB AND `status === 'ACTIVE'`
6. Attach `{ id, phone, role }` to `req.user`

### 5.2 RBAC Middleware

| Middleware | Purpose |
|-----------|---------|
| `requireRole(...roles)` | Check `req.user.role ∈ roles` |
| `requireOrgMember(param)` | Check `OrgMember` exists for `req.user.id` + `req.params[param]` |

### 5.3 Rate Limiting

| Endpoint | Window | Max Requests |
|----------|--------|-------------|
| `/api/*` (general) | 15 min | 100/IP |
| `/auth/verify-widget-token` | 15 min | 20/IP |
| `/auth/refresh` | 15 min | 30/IP |
| `/tracking/ping` | 1 min | 10/IP |

### 5.4 Security Headers
- **Helmet** — Sets security headers (CSP, HSTS, X-Frame-Options, etc.)
- **CORS** — Configurable via `CORS_ORIGIN` env var (wildcard blocked in production)
- **Body Size** — 1MB limit for JSON, 10MB for file uploads

---

## 6. Real-Time Architecture (WebSocket)

### Socket.IO Gateway

```
Client ──► WS Connect (JWT auth) ──► Server
       ◄── Connection Confirmed ◄──

Client ──► join:trip (tripId)     ──► Verify access → Join room
Client ──► join:org (orgId)       ──► Verify membership → Join room
Client ──► join:chat (threadId)   ──► Verify access → Join room
Client ──► join:account (acctId)  ──► Verify access → Join room
Client ──► typing (threadId)      ──► Broadcast to room
Client ──► send:message (data)    ──► Create message → Broadcast
```

### Redis Pub/Sub Channels

| Channel Pattern | Publisher | Subscriber |
|----------------|-----------|------------|
| `thread:${threadId}:message` | ChatService | SocketGateway |
| `trip:${tripId}:location` | TrackingService | SocketGateway |
| `trip:${tripId}:status` | TripService | SocketGateway |
| `org:${orgId}:notification` | Various services | SocketGateway |

### Broadcasting Flow
```
Service creates data
    │
    ▼
redisPublisher.publish(channel, JSON)
    │
    ▼
SocketGateway.subscribeToRedis() receives message
    │
    ▼
io.to(roomName).emit(event, data)
    │
    ▼
All connected clients in room receive update
```

---

## 7. Infrastructure & Config

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_HOST` | ❌ | localhost | Redis host |
| `REDIS_PORT` | ❌ | 6379 | Redis port |
| `REDIS_PASSWORD` | ❌ | — | Redis password |
| `JWT_ACCESS_SECRET` / `JWT_SECRET` | ✅ | — | JWT signing secret (≥32 chars in prod) |
| `JWT_ACCESS_EXPIRATION` | ❌ | 15m | Access token TTL |
| `REFRESH_TOKEN_EXPIRY_DAYS` | ❌ | 30 | Refresh token TTL |
| `MSG91_AUTH_KEY` | ✅ | — | MSG91 API key |
| `MSG91_WIDGET_ID` | ✅ | — | OTP widget ID |
| `MSG91_TOKEN_AUTH` | ✅ | — | Widget token auth |
| `AWS_ACCESS_KEY_ID` | ✅ | — | S3 credentials |
| `AWS_SECRET_ACCESS_KEY` | ✅ | — | S3 credentials |
| `AWS_S3_BUCKET` | ✅ | — | S3 bucket name |
| `AWS_REGION` | ❌ | ap-south-1 | AWS region |
| `AWS_S3_ENDPOINT` | ❌ | — | MinIO endpoint (dev) |
| `CORS_ORIGIN` | ❌ | http://localhost:3001 | Allowed origins |
| `PORT` | ❌ | 3000 | Server port |

### Graceful Shutdown
```
SIGTERM/SIGINT received
  → Stop accepting new connections
  → Close HTTP server
  → Disconnect Prisma
  → Quit Redis
  → Force exit after 10s timeout
```

---

## 8. Error Handling Strategy

### Error Classes
```
AppError (base) — { statusCode, message, isOperational }
  ├── ValidationError     (400)
  ├── UnauthorizedError   (401)
  ├── ForbiddenError      (403)
  ├── NotFoundError       (404)
  └── ConflictError       (409)
```

### Error Middleware
Global `errorHandler` catches all errors:
- `AppError` → Return `{ success: false, message }` with statusCode
- `ZodError` (validation) → 400 with field-level errors
- Unknown errors → 500 with generic message (details logged, not exposed)

### Non-Blocking Pattern
Chat/notification side-effects wrapped in try-catch outside core transactions:
```typescript
// Business logic (MUST succeed)
const payment = await prisma.$transaction(async (tx) => { ... });

// Chat notification (non-blocking — failure doesn't affect payment)
try {
  await chatService.sendPaymentUpdateCard(accountId, payment, 'CONFIRMED');
} catch (error) {
  logger.error('Failed to post chat card:', error);
}
```

---

## 9. Caching Strategy

| Key Pattern | TTL | Invalidation |
|------------|-----|-------------|
| `search:org:${query}` | 5min | Natural expiry |
| `drivers:list:${filter}:${page}:${limit}` | 30min | On create/update/delete |
| `driver:${id}` | 1hr | On update/delete |
| `trucks:list:${orgId}:${page}:${limit}` | 30min | On create/update/delete |
| `truck:${id}` | 1hr | On update/delete |
| `items:list:${orgId}:${filters}` | 1hr | On create/update/delete |
| `item:${id}` | 1hr | On update/delete |
| `blacklist:${token}` | Token remaining TTL | Never (auto-expires) |
| `trip:${tripId}:meta` | 5min | On trip update |
| `trip:${tripId}:lastPing` | 30s | Per location ping |

---

## 10. Key Business Flows

### 10.1 Complete Trip Lifecycle

```
Source Mahajan                    Driver                  Destination Mahajan
      │                            │                            │
      │ POST /trips                │                            │
      │──────────────────────────► │                            │
      │ trip.status = CREATED      │                            │
      │                            │                            │
      │ PATCH /trips/:id/status    │                            │
      │ { status: ASSIGNED }       │                            │
      │──────────────────────────► │                            │
      │                            │                            │
      │ POST /trips/:id/load-card  │                            │
      │ { items: [...] }           │                            │
      │──────────────────────────► │                            │
      │ status = LOADED            │                            │
      │ Chat: TRIP_CARD posted     │                            │
      │                            │                            │
      │                            │ POST /tracking/ping        │
      │                            │ { locations: [...] }       │
      │                            │──────► Redis ──► Socket.IO │
      │                            │ status = IN_TRANSIT        │
      │                            │                            │
      │                            │                            │ POST /trips/:id/receive-card
      │                            │                            │ { items: [...] }
      │                            │                            │◄─────────────────
      │                            │                            │ status = DELIVERED
      │                            │                            │ Shortage calculated
      │                            │                            │ Chat: SHORTAGE_ALERT
      │                            │                            │
      │ PATCH /trips/:id/status { status: COMPLETED }           │
      │─────────────────────────────────────────────────────────►│
```

### 10.2 Payment Confirmation Flow

```
Receiver (Creditor)              System                    Sender (Debtor)
      │                            │                            │
      │ POST /payments/request     │                            │
      │ { accountId, amount }      │                            │
      │──────────────────────────► │                            │
      │ Chat: 🔔 ₹X requested     │                            │
      │                            │                            │
      │                            │                            │ POST /payments/mark-paid
      │                            │                            │ { paymentId, mode, utr }
      │                            │◄─────────────────────────── │
      │ Chat: 💸 ₹X marked paid   │                            │
      │                            │                            │
      │ POST /payments/confirm     │              OR            │
      │ { paymentId }              │                            │
      │──────────────────────────► │                            │
      │ Ledger: balance adjusted   │ POST /payments/dispute     │
      │ Chat: ✅ ₹X confirmed     │ { paymentId, reason }      │
      │                            │──────────────────────────► │
      │                            │ Chat: ⚠️ ₹X disputed      │
```

---

## 11. Frontend Integration Guide

### 11.1 Authentication Flow
1. Initialize MSG91 widget with `GET /auth/widget-config`
2. User completes OTP → get `accessToken` from widget
3. `POST /auth/verify-widget-token { accessToken }`
4. If `isNewUser: true` → show registration form → `POST /auth/register`
5. Store `tokens.accessToken` + `tokens.refreshToken` in secure storage
6. On 401 response → `POST /auth/refresh` → retry original request

### 11.2 WebSocket Connection
```javascript
const socket = io('ws://server:3000', {
  auth: { token: accessToken }
});

socket.emit('join:org', orgId);           // Org notifications
socket.emit('join:trip', tripId);         // Trip tracking
socket.emit('join:chat', threadId);       // Chat room
socket.emit('join:account', accountId);   // Account updates

socket.on('new:message', (msg) => { ... });
socket.on('location:update', (loc) => { ... });
socket.on('trip:status', (data) => { ... });
```

### 11.3 Chat Card Rendering Rules
```
switch (message.messageType) {
  case 'TEXT'             → Plain text bubble
  case 'TRIP_CARD'        → Trip summary card (route, items, status)
  case 'PAYMENT_REQUEST'  → Payment card with action buttons
  case 'INVOICE_CARD'     → Invoice card with amount + due date
  case 'DATA_GRID'        → Scrollable table (Excel-like)
  case 'SYSTEM_MESSAGE'   → Centered gray label
  case 'IMAGE'            → Image with tap-to-expand
  case 'LOCATION'         → Map preview
}
```

### 11.4 Payment Card Button Visibility

| Status | Sender Sees | Receiver Sees |
|--------|------------|---------------|
| PENDING | "Mark as Paid" button | "Cancel" button |
| MARKED_AS_PAID | Status label | "Confirm" + "Dispute" buttons |
| CONFIRMED | ✅ Done | ✅ Done |
| DISPUTED | ⚠️ Disputed | "Re-request" option |

---

> **End of Document**  
> This LLD covers all 14 backend modules, 882-line Prisma schema, 60+ API endpoints, real-time WebSocket architecture, caching strategy, security model, and frontend integration guidelines.
