# Mahajan Network Platform — Frontend API Documentation

> **Generated:** 2026-03-14
> **Covers:** All features built in Sprint 1 → Sprint 10
> **Base URL:** `{{API_URL}}/api/v1`
> **Auth Header:** `Authorization: Bearer <accessToken>`
> **Phone format:** `+91XXXXXXXXXX` (with country code)
> **Amounts:** All monetary values returned from backend are in **paise** (1₹ = 100 paise). Divide by 100 for display. POST/PATCH amounts are in **rupees** unless noted otherwise.

---

## Table of Contents

1. [Authentication & Registration](#1-authentication--registration)
2. [Organization Management](#2-organization-management)
3. [User Profile & Settings](#3-user-profile--settings)
4. [User Actions (Contact Discovery, GSTIN, Reports)](#4-user-actions)
5. [Drivers](#5-drivers)
6. [Trucks](#6-trucks)
7. [Items (Item Master)](#7-items-item-master)
8. [File Uploads (S3)](#8-file-uploads-s3)
9. [Trips (Load Cards & Receive Cards)](#9-trips)
10. [GPS Tracking](#10-gps-tracking)
11. [Map & Geocoding](#11-map--geocoding)
12. [Ledger (Accounts & Transactions)](#12-ledger)
13. [Invoices (with Line Items)](#13-invoices)
14. [Payments](#14-payments)
15. [Razorpay Payment Gateway](#15-razorpay-payment-gateway)
16. [Khata Contacts (Offline Ledger)](#16-khata-contacts)
17. [Chat System](#17-chat-system)
18. [Driver Payments](#18-driver-payments)
19. [Data Exports](#19-data-exports)
20. [Push Notifications (FCM)](#20-push-notifications)
21. [Overdue Invoice Reminders](#21-overdue-invoice-reminders)
22. [WebSocket (Real-Time Events)](#22-websocket-real-time-events)
23. [Error Handling](#23-error-handling)

---

## 1. Authentication & Registration

### Login / Registration Flow

```
Step 1: GET  /auth/widget-config          → get MSG91 widgetId + tokenAuth
Step 2: User completes OTP via MSG91 SDK  → receives accessToken from SDK
Step 3: POST /auth/verify-widget-token    → backend verifies
        ├─ Existing user → returns { user, tokens }      (LOGIN DONE)
        └─ New user      → returns { verificationToken }  (go to Step 4)
Step 4: POST /auth/register               → complete signup
```

### `GET /auth/widget-config`
**Access:** Public
**Response:**
```json
{ "success": true, "data": { "widgetId": "...", "tokenAuth": "..." } }
```

### `POST /auth/verify-widget-token`
**Access:** Public (rate-limited: 20 req/15min)
**Request:**
```json
{ "accessToken": "msg91_access_token_from_sdk" }
```
**Response (existing user):**
```json
{
  "success": true,
  "isNewUser": false,
  "user": { "id": "...", "name": "...", "phone": "+91...", "role": "MAHAJAN", "photoUrl": "...", "bio": "..." },
  "tokens": { "accessToken": "jwt...", "refreshToken": "..." }
}
```
**Response (new user):**
```json
{
  "success": true,
  "isNewUser": true,
  "phone": "+919876543210",
  "verificationToken": "temp_token_for_registration"
}
```

### `POST /auth/register`
**Access:** Public
**Request:**
```json
{
  "name": "Rajesh Kumar",
  "verificationToken": "from_verify_step",
  "registerAs": "MAHAJAN"
}
```
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | ✅ | Min 2, max 100 chars |
| `verificationToken` | string | ✅ | From verify-widget-token |
| `registerAs` | enum | ❌ | `MAHAJAN` (default) or `DRIVER` |

**Response:** `201` — `{ success, user, tokens }`

### `POST /auth/refresh`
**Access:** Public (rate-limited: 30 req/15min)
**Request:** `{ "refreshToken": "..." }`
**Response:** `{ "success": true, "tokens": { "accessToken": "...", "refreshToken": "..." } }`

### `POST /auth/logout` 🔒
**Request (optional):** `{ "refreshToken": "..." }`
Blacklists access token in Redis + revokes refresh token.

### `POST /auth/fcm-token` 🔒
**Request:** `{ "fcmToken": "firebase_device_token" }`
Call this on every app open and when the FCM token refreshes.

---

## 2. Organization Management

### `POST /orgs` 🔒
Create a new organization (Mahajan).
```json
{
  "name": "Rajesh Traders",
  "city": "Nashik",
  "phone": "+919876543210",
  "address": {
    "line1": "Shop No. 45, Pimpalgaon Baswant APMC",
    "city": "Nashik",
    "state": "Maharashtra",
    "pincode": "422209"
  },
  "gstin": "27AABCU9603R1ZV",
  "roleType": "SOURCE_COLLECTOR"
}
```
| `roleType` | `SOURCE_COLLECTOR`, `DESTINATION_DISTRIBUTOR`, `BOTH` |
|---|---|

### `GET /orgs` 🔒
Get your orgs. Add `?search=kumar` to search globally by name/phone (min 2 chars).
Add `?phone=+919876543210` for exact phone match — used in "Add Mahajan" flow.

### `GET /orgs/:orgId` 🔒
### `PATCH /orgs/:orgId` 🔒
### `DELETE /orgs/:orgId` 🔒

---

## 3. User Profile & Settings

### `GET /profile` 🔒
Returns current user profile including org and driver profile if applicable.

### `PATCH /profile/name` 🔒
```json
{ "name": "Rajesh Kumar" }
```

### `PATCH /profile/bio` 🔒
```json
{ "bio": "Vegetable trader, Azadpur mandi" }
```
Max 200 chars.

### Profile Photo (2-step S3 upload)

**Step 1: `POST /profile/photo/upload-url`** 🔒
```json
{
  "filename": "photo.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 245000
}
```
**Response:** `{ "uploadUrl": "https://s3...", "fileId": "...", "s3Key": "..." }`
Upload directly to S3 using the `uploadUrl`.

**Step 2: `POST /profile/photo/confirm`** 🔒
```json
{ "fileId": "...", "s3Key": "..." }
```

**`DELETE /profile/photo`** 🔒 — Removes photo and deletes from S3.

### Phone Number Change (2-Step OTP Flow)

**Step 1: `POST /profile/phone/request-change`** 🔒
```json
{ "newPhone": "+916202923165" }
```
Returns a `phoneChangeToken` (expires in 10 minutes).

**Step 2: `POST /profile/phone/confirm-change`** 🔒
```json
{
  "phoneChangeToken": "from_step_1",
  "msg91AccessToken": "from_msg91_otp_widget"
}
```

> ⚠️ **CRITICAL:** On success the backend revokes ALL tokens. **Force-logout the user immediately** and redirect to login screen.

---

## 4. User Actions

### `POST /users/check-contacts` 🔒
Contact discovery — check which phone numbers are registered Mahajans.
**Rate limit:** 10 req/min
**Request:**
```json
{ "phones": ["+919876543210", "+919812345678", "9876543211"] }
```
Max 500 numbers per request. Returns list of registered users.

### `POST /users/me/gstin` 🔒
Submit GSTIN for verification.
```json
{ "gstin": "21ABCDE1234F1Z5" }
```

### `GET /users/me/gstin` 🔒
Check GSTIN verification status.

### `POST /users/:userId/report` 🔒
Report a user. Uses **upsert** — repeat reports update severity, not duplicate.
```json
{
  "reason": "FRAUD",
  "details": "Sent fake payment screenshots"
}
```
| `reason` values | `SPAM`, `FRAUD`, `HARASSMENT`, `FAKE_ACCOUNT`, `OTHER` |
|---|---|

---

## 5. Drivers

### `POST /drivers` 🔒
```json
{
  "userId": "clxyz...",
  "licenseNo": "OD1234567890",
  "emergencyPhone": "+919876543210",
  "altPhone": "+919812345678",
  "notes": "Experienced in long-haul routes",
  "deviceId": "device_123"
}
```

### `GET /drivers` 🔒
Query: `?orgId=xxx` (optional filter)

### `GET /drivers/:driverId` 🔒
### `PATCH /drivers/:driverId` 🔒
### `DELETE /drivers/:driverId` 🔒

### `GET /drivers/:driverId/trips?status=ACTIVE` 🔒
Get active trips assigned to a driver.

---

## 6. Trucks

### `POST /trucks` 🔒
```json
{
  "orgId": "clxyz...",
  "number": "OD 02 AB 1234",
  "type": "16 Wheeler",
  "capacity": 16
}
```

### `GET /trucks` 🔒
Query: `?orgId=xxx`
### `GET /trucks/:truckId` 🔒
### `PATCH /trucks/:truckId` 🔒
### `DELETE /trucks/:truckId` 🔒

---

## 7. Items (Item Master)

> All routes require org membership. Path: `/api/v1/items/:orgId`

### `POST /items/:orgId` 🔒
```json
{
  "name": "Tomato",
  "nameHindi": "टमाटर",
  "category": "Vegetables",
  "hsn": "0702",
  "defaultUnit": "KG",
  "defaultCustomUnit": null
}
```
| `defaultUnit` values | `KG`, `QUINTAL`, `TON`, `PETI`, `SACK`, `TRAY`, `BUNDLE`, `CRATE`, `DOZEN`, `PIECE`, `OTHER` |
|---|---|

### `GET /items/:orgId` 🔒
Returns org-specific + global items.
Query: `?search=tomato&category=Vegetables&includeInactive=false&page=1&limit=50`

### `GET /items/:orgId/categories` 🔒
Get distinct item categories.

### `GET /items/:orgId/:itemId` 🔒
### `PATCH /items/:orgId/:itemId` 🔒
### `DELETE /items/:orgId/:itemId` 🔒
Soft-delete (deactivates the item).

---

## 8. File Uploads (S3)

### Option A: Presigned URL Flow (Recommended for Mobile)

**Step 1: `POST /files/presigned-url`** 🔒
```json
{
  "filename": "load_photo.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 2456000,
  "purpose": "LOAD_CARD",
  "skipCompression": false
}
```
| `purpose` values | `LOAD_CARD`, `RECEIVE_CARD`, `PAYMENT_PROOF`, `INVOICE`, `CHAT_ATTACHMENT`, `PROFILE_PHOTO` |
|---|---|

**Response:** `{ uploadUrl, fileId, s3Key }` → Upload directly to S3 from device.

**Step 2: `POST /files/confirm-upload`** 🔒
```json
{ "fileId": "clxyz...", "s3Key": "attachments/..." }
```

### Option B: Server-Side Compressed Upload

**`POST /files/upload-compressed`** 🔒
Content-Type: `multipart/form-data`
Fields: `file` (binary), `filename`, `mimeType`, `purpose`, `skipCompression`
Server compresses images automatically. Max 10MB.

> ⚠️ For audio uploads: always set `skipCompression: true`.

### `GET /files/:fileId/download-url` 🔒
Returns a time-limited S3 download URL.

### `GET /files/:fileId` 🔒
Get file metadata.

### `DELETE /files/:fileId` 🔒

---

## 9. Trips

### `POST /trips` 🔒
```json
{
  "sourceOrgId": "clxyz...",
  "destinationOrgId": "clabc...",
  "truckNumber": "OD 02 AB 1234",
  "driverPhone": "+919876543210",
  "startPoint": "Sambalpur Mandi",
  "endPoint": "Bhubaneswar Market",
  "sourceLat": 21.4669, "sourceLng": 83.9812,
  "destLat": 20.2961, "destLng": 85.8245,
  "estimatedDistance": 320,
  "estimatedArrival": "2026-03-12T14:00:00.000Z",
  "notes": "Fragile items - handle with care",
  "sourceAddress": { "line1": "...", "city": "Sambalpur", "state": "Odisha", "pincode": "768001" },
  "destinationAddress": { "line1": "...", "city": "Bhubaneswar", "state": "Odisha", "pincode": "751001" },
  "driverPaymentAmount": 5000,
  "driverPaymentPaidBy": "SOURCE",
  "goodsPaymentStatus": "PENDING",
  "goodsPaymentAmount": 25000,
  "goodsPaymentTag": "OTHER"
}
```
> Either `destinationOrgId` OR `receiverPhone` is required (not both).

### `GET /trips` 🔒
Query: `?orgId=xxx&status=ACTIVE`

### `GET /trips/:tripId` 🔒
Full trip details with load card, receive card, driver, truck.

### `PATCH /trips/:tripId` 🔒
Unified update — handles status changes, edits, cancellation, driver changes.
```json
{ "status": "IN_TRANSIT", "remarks": "Driver departed" }
```
**Cancellation:** `{ "status": "CANCELLED", "cancelReason": "Truck broke down" }`
**Driver change:** `{ "driverPhone": "+91...", "changeReason": "Original driver unavailable" }`

| Status Flow | `CREATED` → `ASSIGNED` → `LOADED` → `IN_TRANSIT` → `DELIVERED` → `COMPLETED` |
|---|---|
| Cancel from | `CREATED`, `ASSIGNED`, or `LOADED` only |

### `POST /trips/:tripId/load-cards` 🔒
Source Mahajan creates the load card.
```json
{
  "items": [
    {
      "itemName": "Tomato",
      "itemNameHindi": "टमाटर",
      "quantity": 50,
      "unit": "PETI",
      "rate": 450,
      "grade": "A",
      "remarks": "Fresh lot"
    }
  ],
  "attachmentIds": ["clxyz..."],
  "remarks": "Loaded at 6 AM"
}
```

### `POST /trips/:tripId/receive-cards` 🔒
Destination Mahajan confirms receipt.

> ✅ **Auto-creates Invoice + LedgerEntry if items have rates.**

```json
{
  "items": [
    {
      "loadItemId": "cl_load_item_id",
      "itemName": "Tomato",
      "quantity": 48,
      "unit": "PETI",
      "rate": 450,
      "qualityIssue": "2 peti damaged",
      "remarks": "Received with minor damage"
    }
  ],
  "attachmentIds": ["clxyz..."],
  "remarks": "Received at 2 PM"
}
```

### Trip Tracking Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /trips/:tripId/latest` | Latest GPS location |
| `GET /trips/:tripId/locations` | Full location history |
| `GET /trips/:tripId/route` | Mapbox driving route polyline (cached 24h) |

---

## 10. GPS Tracking

### `POST /tracking/ping` 🔒 (Driver only)
**Rate limit:** 10 req/min
Submit batched GPS pings.
```json
{
  "tripId": "clxyz...",
  "driverId": "clabc...",
  "locations": [
    {
      "latitude": 21.4669,
      "longitude": 83.9812,
      "accuracy": 10.5,
      "speed": 45.2,
      "timestamp": "2026-03-11T10:30:00.000Z"
    }
  ]
}
```
Max 500 locations per batch.

---

## 11. Map & Geocoding

**Rate limit:** 30 req/min for all map endpoints.

### `GET /map/geocode/forward` 🔒
Search text → locations.
Query: `?q=Sambalpur Mandi&limit=5`

### `GET /map/geocode/reverse` 🔒
Pin drop → address.
Query: `?lat=21.4669&lng=83.9812`

---

## 12. Ledger

### `POST /ledger/accounts` 🔒
Create or get account between two orgs.
```json
{ "ownerOrgId": "clxyz...", "counterpartyOrgId": "clabc..." }
```

### `GET /ledger/accounts?orgId=xxx` 🔒
All accounts for an org. Returns each account with `balance` and `advanceBalance` (both in paise).

### `GET /ledger/accounts/:accountId` 🔒
**Ledger Summary** — use this to show the account balance header on the khata screen.
```json
{
  "id": "clxyz...",
  "ownerOrgId": "...",
  "counterpartyOrgId": "...",
  "balance": "150000",
  "advanceBalance": "50000",
  "ownerOrg": { "id": "...", "name": "Rajesh Traders" },
  "counterpartyOrg": { "id": "...", "name": "Shaikh Co." }
}
```
> `balance` = total outstanding in paise (₹1,500). `advanceBalance` = pre-paid advance not yet applied to any invoice (₹500).

### `GET /ledger/accounts/:accountId/timeline?limit=50&offset=0` 🔒
Chronological list of every financial event on this account. Each entry carries a **running balance**.

**Full LedgerEntry object:**
```json
{
  "id": "clentry...",
  "accountId": "clacc...",
  "direction": "RECEIVABLE",
  "amount": "150000",
  "balance": "150000",
  "description": "Invoice TRIP-ABCD1234",
  "transactionType": "TRIP",
  "referenceType": "INVOICE",
  "referenceId": "clinvoice...",
  "tripId": "cltrip...",
  "note": null,
  "tag": null,
  "createdAt": "2026-03-10T08:00:00.000Z"
}
```

| Field | What it means |
|---|---|
| `direction` | `RECEIVABLE` = money owed TO you. `PAYABLE` = you owe money. |
| `amount` | This transaction's amount in paise |
| `balance` | Running account balance AFTER this entry in paise — use for the balance column in ledger UI |
| `transactionType` | Why this entry was created (see table below) |
| `referenceType` | What record caused it: `INVOICE`, `PAYMENT`, `ADVANCE_APPLIED` |
| `referenceId` | ID of that record — use for deep-linking to invoice/payment detail |

| `transactionType` | Meaning |
|---|---|
| `TRIP` | Auto-created when destination mahajan submits receive card |
| `INVOICE` | Manually created invoice |
| `PAYMENT` | Payment confirmed (two-party or direct) |
| `ADVANCE` | Advance payment recorded |
| `ADVANCE_APPLIED` | Advance auto-deducted from a new invoice |
| `ADJUSTMENT` | Manual correction entry |

**Full response shape:**
```json
{
  "entries": [ ...LedgerEntry[] ],
  "account": { "balance": "150000", "advanceBalance": "0" },
  "pagination": { "total": 45, "limit": 50, "offset": 0 }
}
```

---

## 13. Invoices

### `POST /ledger/invoices` 🔒
Supports **itemized line items** with auto-calculation.
```json
{
  "accountId": "clxyz...",
  "invoiceNumber": "INV-2026-001",
  "amount": 25000,
  "description": "March vegetable supply",
  "dueDate": "2026-03-25T00:00:00.000Z",
  "attachmentIds": ["clfile..."],
  "items": [
    { "itemName": "Tomato", "itemNameHindi": "टमाटर", "quantity": 50, "unit": "KG", "rate": 30 },
    { "itemName": "Onion", "itemNameHindi": "प्याज", "quantity": 100, "unit": "KG", "rate": 22 }
  ]
}
```

> **Auto-calc rule:** If `amount` is omitted but `items` have rates, backend automatically calculates `total = Σ(quantity × rate)` and converts to paise.

**Response includes:** `total`, `paidAmount`, `dueAmount` (all in paise), `status` (`OPEN`, `PARTIAL`, `PAID`), `items[]`.

### `GET /ledger/accounts/:accountId/invoices` 🔒

### `PATCH /ledger/invoices/:invoiceId` 🔒
```json
{ "isPaid": true, "paidAmount": 15000, "notes": "Partial payment received" }
```

---

## 14. Payments

> ⚠️ **There are two separate payment endpoints. Pick the right one.**

| Situation | Use |
|---|---|
| UPI / bank transfer — both parties on the app — need confirmation | Two-party flow → `POST /ledger/payments/request` |
| Cash in hand, mandi payment, no confirmation needed | Direct recording → `POST /ledger/payments` |

**Key difference:** Direct recording updates the ledger immediately. Two-party flow only updates the ledger when the receiver confirms.

---

### Option A — Two-Party Flow (UPI / Bank Transfer)

```
Step 1: Receiver creates request   → POST /ledger/payments/request
Step 2: Sender marks as paid       → PATCH /ledger/payments/:paymentId { status: "PAID", ... }
Step 3: Receiver confirms/disputes → PATCH /ledger/payments/:paymentId { status: "CONFIRMED" | "DISPUTED" }
```

> 💡 **Ledger balance does NOT change until Step 3 CONFIRMED.** Until then it is just a claim.

**Step 1 — Receiver creates payment request:**

### `POST /ledger/payments/request` 🔒
```json
{
  "accountId": "clxyz...",
  "amount": 15000,
  "tag": "PARTIAL",
  "mode": "UPI",
  "remarks": "For March invoice",
  "invoiceId": "clinv..."
}
```
| `tag` values | `ADVANCE`, `PARTIAL`, `FINAL`, `OTHER` |
|---|---|

**Step 2 — Sender marks as paid / Step 3 — Receiver confirms or disputes:**

### `PATCH /ledger/payments/:paymentId` 🔒

```json
// Sender marks paid:
{
  "status": "PAID",
  "mode": "UPI",
  "utrNumber": "UTR123456789",
  "proofNote": "Paid via PhonePe",
  "attachmentIds": ["clxyz..."]
}

// Receiver confirms → ledger updates NOW:
{ "status": "CONFIRMED" }

// Receiver disputes → ledger unchanged:
{ "status": "DISPUTED", "reason": "Amount mismatch" }
```

| `mode` values | `UPI`, `BANK_TRANSFER`, `CASH`, `CHEQUE`, `OTHER` |
|---|---|

**Payment status flow:**
```
PENDING → MARKED_AS_PAID → CONFIRMED  (ledger updates here)
                         → DISPUTED   (no ledger change)
```

---

### Option B — Direct Recording (Cash / Mandi Payment)

### `POST /ledger/payments` 🔒
Use when cash is physically exchanged and no two-party confirmation is needed. **Ledger updates immediately.**

```json
{
  "accountId": "clxyz...",
  "amount": 5000,
  "tag": "PARTIAL",
  "paymentMethod": "CASH",
  "transactionId": "optional_ref",
  "remarks": "Cash received at mandi gate",
  "attachmentIds": []
}
```

> `paymentMethod` maps to the `mode` field in the response. Values: `UPI`, `BANK_TRANSFER`, `CASH`, `CHEQUE`, `OTHER`

**Response `payment` object:**
```json
{
  "id": "clpay...",
  "accountId": "clacc...",
  "amount": "500000",
  "mode": "CASH",
  "tag": "PARTIAL",
  "status": "CONFIRMED",
  "remarks": "Cash received at mandi gate",
  "createdAt": "2026-03-10T08:00:00.000Z"
}
```

---

### Other payment endpoints

### `GET /ledger/accounts/:accountId/payments` 🔒
### `GET /ledger/accounts/:accountId/pending-payments` 🔒
Returns payments with `status: PENDING` or `MARKED_AS_PAID` only — payments waiting for action.
### `GET /ledger/payments/:paymentId` 🔒

---

## 15. Razorpay Payment Gateway

### Flow
```
1. Frontend calls create-order endpoint → gets order_id
2. Frontend opens Razorpay SDK with order_id
3. User completes payment on Razorpay
4. Frontend calls verify endpoint with Razorpay response
5. Backend verifies signature → auto-confirms payment
```

### `POST /razorpay/create-order/payment` 🔒
For an existing ledger payment request:
```json
{ "paymentId": "clxyz..." }
```

### `POST /razorpay/create-order/trip` 🔒
Creates Payment + Razorpay Order in one go:
```json
{
  "tripId": "clxyz...",
  "accountId": "clabc...",
  "amount": 25000,
  "tag": "FINAL",
  "remarks": "Trip settlement"
}
```
> `amount` is in **rupees** (₹25,000).

### `POST /razorpay/create-order/driver` 🔒
```json
{ "tripId": "clxyz..." }
```

### `POST /razorpay/verify` 🔒
After Razorpay SDK returns success:
```json
{
  "razorpay_order_id": "order_xxx",
  "razorpay_payment_id": "pay_xxx",
  "razorpay_signature": "signature_xxx"
}
```
Backend verifies HMAC signature → auto-confirms the payment.

### `GET /razorpay/order/:orderId/status` 🔒
Check order status.

### `POST /razorpay/webhook` ⚡ Public
Server-to-server webhook — signature verified via `X-Razorpay-Signature` header. **Frontend does not call this.**

---

## 16. Khata Contacts

> For traders who don't use the app. Think of it as a digital khata notebook.

### `POST /ledger/orgs/:orgId/contacts` 🔒
```json
{ "name": "Ramesh Vegetables", "phone": "+919876543210", "city": "Azadpur", "notes": "Cash only" }
```

### `GET /ledger/orgs/:orgId/contacts?page=1&limit=50` 🔒
Returns contacts with their current `balance` (paise).

### `GET /ledger/contacts/:contactId` 🔒
### `PATCH /ledger/contacts/:contactId` 🔒
### `DELETE /ledger/contacts/:contactId` 🔒

### `POST /ledger/contacts/:contactId/entries` 🔒
Record a manual transaction.
```json
{
  "direction": "RECEIVABLE",
  "amount": 2500,
  "description": "Tomato supply 50kg",
  "transactionType": "SALE"
}
```
| `direction` | `RECEIVABLE` = they owe you, `PAYABLE` = you owe them |
|---|---|
| `transactionType` | `SALE`, `PURCHASE`, `ADJUSTMENT` |

### `POST /ledger/contacts/:contactId/payments` 🔒
Record a cash/UPI payment against this contact.
```json
{
  "amount": 1000,
  "mode": "CASH",
  "tag": "PARTIAL",
  "remarks": "Paid at shop"
}
```

### `GET /ledger/contacts/:contactId/timeline` 🔒
Chronological list of entries and payments. Use this to render the khata book UI.

---

## 17. Chat System

> **Architecture:** One chat thread per org pair. All trips, payments, invoices appear as cards inside this single conversation — like WhatsApp but with rich financial cards.

### Threads

**`POST /chat/threads`** 🔒
```json
{ "counterpartyOrgId": "..." }
```
Also accepts `{ "accountId": "..." }` or `{ "tripId": "..." }` — all resolve to the same org-pair thread.

**`POST /chat/start-by-phone`** 🔒
```json
{ "phone": "+919876543210" }
```
Add Mahajan flow — starts chat by phone number.

**`GET /chat/threads`** 🔒
**`GET /chat/threads/:threadId`** 🔒

**`PATCH /chat/threads/:threadId`** 🔒
Unified endpoint — handles pin, archive, and read/delivery receipts:
```json
{ "isPinned": true }
{ "isArchived": false }
{ "readUpTo": "messageId" }
{ "deliveredUpTo": "messageId" }
```

> ⚠️ **Read Receipt Rule:** Only call `readUpTo` when the chat screen is **open and the user is actively viewing it**. Never call it on background fetches, notification handling, or list views. This is what triggers the blue tick on the sender's side.

### Messages

**`GET /chat/threads/:threadId/messages?limit=50&offset=0`** 🔒
Returns messages oldest-first. Excludes deleted messages.

**`POST /chat/threads/:threadId/messages`** 🔒
```json
{ "content": "Hello", "messageType": "TEXT" }
{ "messageType": "IMAGE", "attachmentIds": ["clfile..."] }
{ "messageType": "PDF", "attachmentIds": ["clfile..."] }
{ "messageType": "AUDIO", "attachmentIds": ["clfile..."] }
{ "messageType": "LOCATION", "locationLat": 19.076, "locationLng": 72.877 }
```
Any message can also include `"tripId": "..."` to link it to a specific trip.

**`PATCH /chat/threads/:threadId/messages/:messageId`** 🔒
Edit text message. Sender only. Within 15 minutes.
```json
{ "content": "corrected text" }
```

**`DELETE /chat/threads/:threadId/messages/:messageId`** 🔒
```json
{ "deleteFor": "me" }
```
| `deleteFor` | `me` (soft-delete for yourself) or `everyone` |
|---|---|

### Media

**`GET /chat/threads/:threadId/media-preview`** 🔒
Media counts + thumbnails for "Chat Info" screen.

**`GET /chat/threads/:threadId/media`** 🔒
Paginated gallery: `?type=images|docs|all&limit=30&cursor=xxx`

### Block / Clear / Delete

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat/threads/:threadId/block` | POST | Block the counterparty |
| `/chat/threads/:threadId/unblock` | POST | Unblock |
| `/chat/threads/:threadId/clear` | POST | Soft-delete all messages for yourself |
| `/chat/threads/:threadId` | DELETE | Hard-delete thread + all messages |

### Search & Unread

**`GET /chat/unread`** 🔒 — Unread counts per thread
**`GET /chat/messages?orgId=xxx&q=payment`** 🔒 — Search messages across threads

### Rich Actions (Chat Actions)

**`POST /chat/threads/:threadId/actions`** 🔒
```json
{
  "actionType": "REQUEST_PAYMENT",
  "payload": { "amount": 5000, "accountId": "clxyz..." }
}
```
| `actionType` values |
|---|
| `CREATE_TRIP`, `REQUEST_PAYMENT`, `MARK_PAYMENT_PAID`, `CONFIRM_PAYMENT`, `DISPUTE_PAYMENT`, `CREATE_INVOICE`, `SHARE_DATA_GRID`, `SHARE_LEDGER_TIMELINE` |

---

## 18. Driver Payments

### `POST /trips/:tripId/driver-payment` 🔒
Create or update driver payment terms:
```json
{
  "totalAmount": 5000,
  "paidBy": "SOURCE",
  "remarks": "Standard rate for Sambalpur-Bhubaneswar"
}
```
| `paidBy` | `SOURCE`, `DESTINATION`, `SPLIT` |
|---|---|

For `SPLIT`: also send `splitSourceAmount` and `splitDestAmount`.

### `POST /trips/:tripId/driver-payment/record` 🔒
Record a payment made:
```json
{ "amount": 2000, "remarks": "Advance given at loading" }
```

### `GET /trips/:tripId/driver-payment` 🔒
Get current payment status with breakdown.

### `GET /orgs/:orgId/pending-driver-payments` 🔒
List all unpaid/partially paid driver payments for an org.

---

## 19. Data Exports

### `POST /exports/:orgId` 🔒
```json
{
  "exportType": "LEDGER",
  "format": "XLSX",
  "startDate": "2026-01-01T00:00:00.000Z",
  "endDate": "2026-03-31T23:59:59.000Z",
  "counterpartyOrgId": "clabc...",
  "includeItems": true,
  "includePayments": true
}
```
| `exportType` | `LEDGER`, `TRIPS`, `FULL_REPORT` |
|---|---|
| `format` | `XLSX` (default), `PDF`, `CSV` |

### `GET /exports/:orgId/history` 🔒
Previous export jobs with download links.

---

## 20. Push Notifications

The backend sends FCM push notifications for these events:

| Notification Type | Trigger | Recipient |
|---|---|---|
| `TRIP_CREATED` | New trip created | Destination org |
| `TRIP_STATUS_CHANGED` | Trip status updated | Both orgs |
| `LOAD_CARD_CREATED` | Load card submitted | Destination org |
| `RECEIVE_CARD_CREATED` | Receive card submitted | Source org |
| `PAYMENT_RECEIVED` | Payment confirmed | Creditor org |
| `INVOICE_CREATED` | New invoice created | Debtor org |
| `INVOICE_OVERDUE` | Overdue reminder (daily cron) | Debtor org |
| `CHAT_MESSAGE` | New chat message | Recipient org |

**Frontend must:** Register FCM token via `POST /auth/fcm-token` on every app open.

---

## 21. Overdue Invoice Reminders

**Automatic — no frontend API needed.** The backend runs a daily cron at **9:00 AM IST**.

### How It Works
1. Scans all invoices with status `OPEN` or `PARTIAL` where `dueDate < now`
2. Calculates how many days overdue
3. Sends a **gentle push notification** only on specific days:

| Days Overdue | Action |
|---|---|
| 1 day | Send reminder |
| 2 days | Skip |
| 3 days | Send reminder |
| 4–6 days | Skip |
| 7 days | Send reminder |
| 8–13 days | Skip |
| 14 days | Send reminder |
| Every 7 days after 14 | Send reminder |

### Notification Payload
```json
{
  "type": "INVOICE_OVERDUE",
  "title": "Payment reminder from Rajesh Traders",
  "body": "Friendly reminder — invoice #INV-2026-001 for ₹25,000 from Rajesh Traders is 7 days overdue. Please settle when convenient.",
  "data": {
    "invoiceId": "clinv...",
    "invoiceNumber": "INV-2026-001",
    "dueAmount": "2500000",
    "daysOverdue": "7",
    "creditorOrgName": "Rajesh Traders"
  }
}
```

**Frontend action on tap:** Navigate to the invoice detail screen using `data.invoiceId`.

---

## 22. WebSocket (Real-Time Events)

### Connection
```javascript
import { io } from 'socket.io-client';

const socket = io('{{API_URL}}', {
  path: '/socket.io/',
  auth: { token: accessToken },
  transports: ['websocket', 'polling'],
});
```

### Rooms (Subscribe/Unsubscribe)

| Emit Event | Payload | Confirmation |
|---|---|---|
| `tracking:subscribe` | `{ tripId }` | `tracking:subscribed` |
| `tracking:unsubscribe` | `{ tripId }` | `tracking:unsubscribed` |
| `org:join` | `{ orgId }` | `org:joined` |
| `org:leave` | `{ orgId }` | `org:left` |
| `chat:join` | `{ threadId }` | `chat:joined` |
| `chat:leave` | `{ threadId }` | `chat:left` |
| `account:join` | `{ accountId }` | `account:joined` |
| `account:leave` | `{ accountId }` | `account:left` |

> **Note:** Joining a `chat:` room auto-marks unread messages as **delivered** (double grey tick). The blue tick (read) only fires when you explicitly call `PATCH /chat/threads/:id { "readUpTo": "..." }`.

### Listening for Events

```javascript
// GPS tracking updates (real-time on map)
socket.on('tracking:location-update', (data) => { /* { lat, lng, speed, ... } */ });

// Trip status changes
socket.on('trip:status-update', (data) => { /* { tripId, status, ... } */ });

// New chat messages
socket.on('chat:message', (data) => { /* full message object */ });

// Message delivery receipts (double grey tick)
socket.on('chat:delivered', (data) => { /* { threadId, userId, deliveredAt, count } */ });

// Read receipts (blue tick)
socket.on('chat:read', (data) => { /* { threadId, userId, readAt, count } */ });

// Message edited
socket.on('chat:edit', (data) => { /* updated message object */ });

// Message deleted for everyone
socket.on('chat:delete', (data) => { /* { messageId, deletedFor, deletedByUserId } */ });

// Thread blocked/unblocked
socket.on('chat:blocked', (data) => { /* { blockedByOrgId, blockedAt } */ });
socket.on('chat:unblocked', (data) => { /* { threadId } */ });

// Errors
socket.on('error', (data) => { /* { message } */ });
```

### Read Receipt Logic (WhatsApp-style)

| Tick | Meaning | Triggered by |
|---|---|---|
| ✓ grey | Sent | Message saved in DB |
| ✓✓ grey | Delivered to device | Receiver calls `chat:join` via socket |
| ✓✓ blue | Receiver read it | Frontend calls `PATCH /chat/threads/:id { readUpTo: lastMsgId }` |

> **Frontend responsibility:** Call `readUpTo` only when the chat screen is open and visible. Not on background syncs, not on list views, not in notification handlers.

---

## 23. Error Handling

### Standard Error Response
```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    { "path": ["phones"], "message": "At least 1 phone number required" }
  ]
}
```

### HTTP Status Codes

| Code | Type | When |
|------|------|------|
| `400` | ValidationError | Invalid input / Zod schema failure |
| `401` | UnauthorizedError | Token missing, invalid, or expired |
| `403` | ForbiddenError | Not in org, insufficient role |
| `404` | NotFoundError | Resource doesn't exist |
| `409` | ConflictError | Duplicate data (e.g., phone already registered) |
| `429` | TooManyRequests | Rate limit exceeded |
| `500` | InternalServerError | Server error |

### Rate Limits Summary

| Endpoint | Limit |
|----------|-------|
| All `/api/*` | 100 req / 15 min per IP |
| `/auth/verify-widget-token` | 20 req / 15 min |
| `/auth/refresh` | 30 req / 15 min |
| `/tracking/ping` | 10 req / 1 min |
| `/users/check-contacts` | 10 req / 1 min |
| `/map/geocode/*` | 30 req / 1 min |

---

## Address Object Schema

Used across Org, Trip, and other endpoints:
```json
{
  "label": "Main Office",
  "line1": "Mandi Road, Near Bus Stand",
  "line2": "Shop No. 12",
  "city": "Sambalpur",
  "state": "Odisha",
  "pincode": "768001",
  "landmark": "Opposite SBI Branch",
  "contactName": "Rajesh",
  "contactPhone": "+919876543210"
}
```
| Field | Required | Notes |
|-------|----------|-------|
| `line1` | ✅ | Max 200 chars |
| `city` | ✅ | Max 100 chars |
| `state` | ✅ | Max 100 chars |
| `pincode` | ✅ | Exactly 6 digits |
| All others | ❌ | Optional |

---

> 🔒 = Requires `Authorization: Bearer <accessToken>` header
> ⚡ = Public endpoint (no auth)