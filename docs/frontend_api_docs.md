# Mahajan Network Platform — Frontend API Documentation

> **Generated:** 2026-03-11  
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
14. [Payments (Two-Party Flow)](#14-payments-two-party-flow)
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
**Request:**
```json
{
  "name": "Rajesh Traders",
  "city": "Sambalpur",
  "phone": "+919876543210",
  "gstin": "21ABCDE1234F1Z5",
  "roleType": "BOTH",
  "address": {
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
}
```
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | ✅ | Min 2 chars |
| `city` | string | ❌ | |
| `phone` | string | ❌ | `+91XXXXXXXXXX` format |
| `gstin` | string | ❌ | Valid 15-char GSTIN |
| `roleType` | enum | ❌ | `SOURCE`, `DESTINATION`, `BOTH` (default) |
| `address` | object | ❌ | Structured address (see format above) |

### `GET /orgs` 🔒
Get all organizations for the current user.

### `GET /orgs/:orgId` 🔒
Get org by ID (must be a member).

### `PATCH /orgs/:orgId` 🔒
Update org fields (owner only). Same body as create, all fields optional.

### `DELETE /orgs/:orgId` 🔒
Delete organization (owner only).

---

## 3. User Profile & Settings

> **Base path:** `/api/v1/profile`

### `GET /profile` 🔒
Get current user's profile (name, bio, photoUrl, phone, orgs, etc.)

### `PATCH /profile/name` 🔒
```json
{ "name": "Rajesh Kumar Mahajan" }
```
Min 2, max 100 characters.

### `PATCH /profile/bio` 🔒
```json
{ "bio": "Wholesale trader from Sambalpur, dealing in vegetables since 2005" }
```
Max 200 characters. Send empty string to clear.

### Profile Photo Upload (2-Step S3 Flow)

**Step 1: `POST /profile/photo/upload-url`** 🔒
```json
{
  "filename": "profile.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 245000
}
```
| Field | Type | Notes |
|-------|------|-------|
| `mimeType` | enum | `image/jpeg`, `image/jpg`, `image/png`, `image/webp` |
| `fileSize` | number | Max 5MB (5242880 bytes) |

**Response:** Returns presigned S3 URL → upload image directly from device to S3.

**Step 2: `POST /profile/photo/confirm`** 🔒
```json
{ "fileId": "clxyz...", "s3Key": "profile-photos/..." }
```

### `DELETE /profile/photo` 🔒
Remove profile photo.

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
{
  "status": "IN_TRANSIT",
  "remarks": "Driver departed"
}
```
**Cancellation:** `{ "status": "CANCELLED", "cancelReason": "Truck broke down" }`  
**Driver change:** `{ "driverPhone": "+91...", "changeReason": "Original driver unavailable" }`

| Status Flow | `PENDING` → `IN_TRANSIT` → `DELIVERED` → `COMPLETED` |
|---|---|
| Cancel from | `PENDING` or `IN_TRANSIT` only |

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
Destination Mahajan confirms receipt. **Auto-creates a Ledger Entry.**
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
### `GET /ledger/accounts/:accountId/timeline` 🔒
Chronological timeline of all ledger entries. Each entry includes `transactionType`:

| `transactionType` | Meaning |
|---|---|
| `TRIP` | Auto-created from receive card |
| `INVOICE` | Manually created invoice |
| `PAYMENT` | Payment recorded |
| `ADVANCE` | Advance payment |
| `ADVANCE_APPLIED` | Advance auto-applied to invoice |
| `ADJUSTMENT` | Manual correction |

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

> **Auto-calc rule:** If `amount` is omitted but `items` are provided, the backend automatically calculates `total = Σ(quantity × rate)` and converts to paise.

**Response includes:** `total`, `paidAmount`, `dueAmount` (all in paise), `status` (`OPEN`, `PARTIAL`, `PAID`).

### `GET /ledger/accounts/:accountId/invoices` 🔒

### `PATCH /ledger/invoices/:invoiceId` 🔒
```json
{ "isPaid": true, "paidAmount": 15000, "notes": "Partial payment received" }
```

---

## 14. Payments (Two-Party Flow)

```
Step 1: Receiver creates request  → POST /ledger/payments/request
Step 2: Sender marks as paid      → PATCH /ledger/payments/:paymentId  { status: "PAID", ... }
Step 3: Receiver confirms/disputes → PATCH /ledger/payments/:paymentId  { status: "CONFIRMED" | "DISPUTED" }
```

### `POST /ledger/payments/request` 🔒
```json
{
  "accountId": "clxyz...",
  "amount": 15000,
  "tag": "PARTIAL",
  "remarks": "For March invoice",
  "invoiceId": "clinv..."
}
```
| `tag` values | `ADVANCE`, `PARTIAL`, `FINAL`, `OTHER` |
|---|---|

### `PATCH /ledger/payments/:paymentId` 🔒
**Mark as paid (sender):**
```json
{
  "status": "PAID",
  "mode": "UPI",
  "utrNumber": "UTR123456789",
  "proofNote": "Paid via PhonePe",
  "attachmentIds": ["clxyz..."]
}
```
| `mode` values | `UPI`, `BANK_TRANSFER`, `CASH`, `CHEQUE`, `OTHER` |
|---|---|

**Confirm (receiver):** `{ "status": "CONFIRMED" }`  
**Dispute (receiver):** `{ "status": "DISPUTED", "reason": "Amount mismatch" }`

### `POST /ledger/payments` 🔒 (Legacy/Direct)
Direct payment recording for cash transactions:
```json
{
  "accountId": "clxyz...",
  "amount": 5000,
  "tag": "PARTIAL",
  "paymentMethod": "CASH",
  "remarks": "Cash received at mandi"
}
```

### `GET /ledger/accounts/:accountId/payments` 🔒
### `GET /ledger/accounts/:accountId/pending-payments` 🔒
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

> For traders who don't use the app. An offline ledger per contact.

### `POST /ledger/orgs/:orgId/contacts` 🔒
```json
{
  "name": "Ramesh Farmer",
  "phone": "+919876543210",
  "city": "Bargarh",
  "notes": "Supplies tomatoes seasonally"
}
```

### `GET /ledger/orgs/:orgId/contacts` 🔒
List contacts with their current `balance` (paise). Pagination supported.

### `GET /ledger/contacts/:contactId` 🔒
### `PATCH /ledger/contacts/:contactId` 🔒
### `DELETE /ledger/contacts/:contactId` 🔒

### `POST /ledger/contacts/:contactId/entries` 🔒
Record a sale/purchase/adjustment:
```json
{
  "direction": "RECEIVABLE",
  "amount": 5000,
  "description": "50 kg tomatoes @ ₹100/kg",
  "transactionType": "SALE"
}
```
| `direction` | `PAYABLE` or `RECEIVABLE` |
|---|---|
| `transactionType` | `SALE`, `PURCHASE`, `ADJUSTMENT` |

> Amount is in **rupees**.

### `POST /ledger/contacts/:contactId/payments` 🔒
```json
{
  "amount": 3000,
  "mode": "CASH",
  "tag": "PARTIAL",
  "remarks": "Cash received at mandi"
}
```

### `GET /ledger/contacts/:contactId/timeline` 🔒
Chronological timeline of entries + payments (like a chat UI).

---

## 17. Chat System

> **Architecture:** One single chat thread per org pair. All conversations (trips, payments, text, media) flow through this thread.

### Thread Management

**`POST /chat/threads`** 🔒 — Create or get thread
```json
{ "counterpartyOrgId": "clabc..." }
```
Also accepts `accountId` or `tripId` to auto-resolve the org pair.

**`POST /chat/start-by-phone`** 🔒 — Start chat via phone number
```json
{ "phone": "+919876543210" }
```

**`GET /chat/threads`** 🔒 — List all threads  
**`GET /chat/threads/:threadId`** 🔒 — Get thread details

**`PATCH /chat/threads/:threadId`** 🔒 — Update state
```json
{
  "isPinned": true,
  "isArchived": false,
  "readUpTo": "message_id_xxx",
  "deliveredUpTo": "message_id_xxx"
}
```
At least one field required.

### Messages

**`GET /chat/threads/:threadId/messages`** 🔒 — Paginated messages  
**`POST /chat/threads/:threadId/messages`** 🔒 — Send message
```json
{
  "content": "Hello, sending the tomatoes today",
  "messageType": "TEXT",
  "replyToId": "cl_original_msg_id",
  "clientMessageId": "uuid-for-idempotency",
  "tripId": "cl_trip_id"
}
```
| `messageType` | Required fields |
|---|---|
| `TEXT` | `content` (non-empty) |
| `IMAGE`, `PDF`, `FILE`, `AUDIO` | `attachmentIds` (at least 1) |
| `LOCATION` | `locationLat`, `locationLng` |

**`PATCH /chat/threads/:threadId/messages/:messageId`** 🔒 — Edit message
```json
{ "content": "Updated message text" }
```
> Only TEXT messages, within 15 minutes, by original sender.

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
| 15–20 days | Skip |
| 21 days | Send reminder (14 + 7) |
| 28 days | Send reminder (14 + 14) |
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

> **Note:** Joining a `chat:` room auto-marks unread messages as **delivered**.

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
socket.on('chat:read', (data) => { /* { threadId, userId, readAt } */ });

// Errors
socket.on('error', (data) => { /* { message } */ });
```

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
