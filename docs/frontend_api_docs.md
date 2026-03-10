# Mahajan Network — Release Documentation (Last 24 Hrs)

This is the ultimate, complete reference for **all features and backend modules** implemented in the last 24 hours. It includes the *What/Why* (Feature Explanations) alongside the *How* (API Breakdown) for the frontend developer.

> **Base URL:** `{{API_URL}}/api/v1`
> **Amounts:** All monetary values returned from the backend are in **paise**. Frontend must divide by 100 for display (₹). For POST/PATCH requests, send amounts in rupees unless specified.
> **Phone format:** `+91XXXXXXXXXX` (with country code).

---

## 🌟 Feature Explanations (What we built)

### 1. Unified Chat System (WhatsApp Style)
We overhauled messaging. Instead of multiple random chats, there is now **one single chat thread per organization pair**. All interactions (trips, payments, text, media) happen inside this thread. We added endpoints to generate thumbnails (`media-preview`), paginate the gallery (`media`), block/unblock users, and trigger rich actions (like "Request Payment" or "Create Trip") directly from the chat UI.

### 2. Multi-Item Trips & Flexible Units
Trips are no longer strictly singular. We expanded trips to support a detailed `Load Card` (created by the Source Mahajan) and a `Receive Card` (created by the Destination Mahajan). You can specify exact quantities, prices, and use dynamic units (`PETI`, `SACK`, `QUINTAL`, `TRAY`, `BUNDLE`, `CRATE`). Upon receiving a trip, a Ledger Entry is automatically created.

### 3. Razorpay Payment Gateway & Webhooks
True money movement is now integrated via Razorpay. A user can select to pay a Trip Bill, a generic Ledger Request, or a Driver Payment. The backend generates a Razorpay `order_id` which the frontend passes to the Razorpay SDK. Once paid, the backend verifies the signature natively or listens to server-to-server Webhooks to automatically mark the payment `CONFIRMED`.

### 4. FCM Push Notifications (Auth Module)
We integrated Firebase Cloud Messaging. The app can register a user's device `fcmToken`, allowing the backend's `NotificationWorker` to send background push messages whenever they receive a chat message, trip update, or payment request.

### 5. Khata Contacts (Offline Ledger)
Mahajans do business with traders who don't have our app (e.g., local farmers). "Khata Contacts" are offline ledger entries. You can create a contact, record manual entries (`SALE`, `PURCHASE`, `ADJUSTMENT`), log cash/UPI payments against them, and fetch a chronological timeline showing who owes whom.

### 6. Invoice Line Items & Auto-Calculation
Invoices now support itemized breakdowns. You can define an array of `items` (Tomato, Onion) with their prices and quantities. The backend handles the math perfectly — if you provide the line items without a master `amount`, it dynamically calculates the total and converts it to paise securely.

### 7. Secure Phone Number Change (OTP)
Since phone numbers act as user identities, changing them now requires re-verification. The user enters a new number, verifies it via the MSG91 OTP widget, and passes the resulting token to the backend. The backend updates the database atomically and revokes all login tokens instantly to secure the account.

### 8. Profile Editing & S3 Photo Uploads
Users can modify their display `name` and `bio`. For profile photos, we implemented a direct-to-S3 flow: the frontend gets a presigned S3 URL, uploads the image directly to AWS from the phone, and pings a `/confirm` endpoint to attach it to the profile.

### 9. Report User Mechanism
We implemented a dynamic "Upsert" reporting system. Users can report others for `FRAUD`, `SPAM`, or `HARASSMENT`. If reported multiple times, the backend updates the severity rather than throwing an error or duplicating the data.

---

## 🛠 API Endpoints Breakdown (How it works)

### 1. Auth & Notifications

**POST `/auth/fcm-token`**
Save device token for push notifications.
Request: `{ "fcmToken": "cxyz_device_token..." }`

**POST `/auth/logout`**
Log out and invalidate access/refresh tokens securely.

**GET `/auth/widget-config`** & **POST `/auth/verify-widget-token`**
MSG91 token initialization and verification flow used for Registration and Login.

---

### 2. Chat (One Chat per Org Pair)

**POST `/chat/threads`**
Create/Get an org-pair chat thread using `{ "counterpartyOrgId": "..." }`.

**POST `/chat/start-by-phone`**
Start a chat via a phone number instead of an Org ID.

**GET `/chat/threads` | GET `/chat/threads/:threadId`**
List all chats or get details of a specific thread.

**GET `/chat/threads/:threadId/messages` | POST `/chat/threads/:threadId/messages`**
Fetch or send messages inside the thread.

**GET `/chat/threads/:threadId/media-preview`**
Fetch thumbnails and media counts specifically for the "Chat Info" screen.

**GET `/chat/threads/:threadId/media`**
Fetch the paginated gallery (`?type=images|docs|all`).

**POST `/chat/threads/:threadId/actions`**
Perform rich actions via chat (Create Trip, Request Payment, Share Data). Sent into the chat timeline automatically.

**POST `/chat/threads/:threadId/block`** | **POST `/chat/threads/:threadId/clear`**
Block counterparty or soft-delete all messages for yourself.

---

### 3. Trips (Load & Receive Cards)

**POST `/trips` | GET `/trips`**
Create a new trip ticket or fetch trips.

**POST `/trips/:tripId/load-cards`**
(Source Mahajan only) Create a detailed load card.

**POST `/trips/:tripId/receive-cards`**
(Destination Mahajan only) Confirm receipt. Auto-triggers Ledger Entry Generation!

**Tracking Endpoints:**
- **Latest:** `GET /trips/:tripId/latest`
- **History:** `GET /trips/:tripId/locations`
- **Mapbox Route:** `GET /trips/:tripId/route` (Cached geographic polyline).

---

### 4. Razorpay Payments

**POST `/razorpay/create-order/payment`**
**POST `/razorpay/create-order/trip`**
**POST `/razorpay/create-order/driver`**
All generate a Razorpay order from a specific database entity. Returns the `order_id` to initiate the Razorpay UI.

**POST `/razorpay/verify`**
Verify the payment signature (`razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`) to auto-confirm the payment instantly.

---

### 5. Profile APIs & Phone OTP Change

**GET `/profile`**
Get current user profile.

**PATCH `/profile/name` | PATCH `/profile/bio`**
Update display text fields.

**POST `/profile/photo/upload-url` (Step 1)**
Get an S3 upload URL: `{ "filename": "profile.jpg", "mimeType": "image/jpeg", "fileSize": 245000 }`

**POST `/profile/photo/confirm` (Step 2)**
Confirm photo upload: `{ "fileId": "...", "s3Key": "..." }`

**POST `/profile/phone/request-change` (Step 1)**
Initiates change. Generates the first token. `{ "newPhone": "+916202923165" }` (Expires in 10 mins).

**POST `/profile/phone/confirm-change` (Step 2)**
Confirm with MSG91 output. Requires `phoneChangeToken` + `msg91AccessToken`.
**CRITICAL:** Force-logout user on success.

---

### 6. Khata Contacts & Ledger

> Note: All generic Ledger Entries now return `transactionType` (e.g., `TRIP`, `INVOICE`, `PAYMENT`, `ADVANCE`, `ADVANCE_APPLIED`, `ADJUSTMENT`, `SALE`, `PURCHASE`).

**POST `/ledger/orgs/:orgId/contacts`**
Create offline contact.

**GET `/ledger/orgs/:orgId/contacts`**
List contacts with their current balances (in Paise). Pagination supported.

**POST `/ledger/contacts/:contactId/entries`**
Record a manual Khata transaction (Sale/Purchase/Adjustment). Send `amount` in Rupees.

**POST `/ledger/contacts/:contactId/payments`**
Record a manual Khata payment (Cash/UPI/Cheque).

**GET `/ledger/contacts/:contactId/timeline`**
Get chronological timeline of entries and payments just like a chat UI.

---

### 7. Invoices (Auto-Calc)

**POST `/ledger/invoices`**
Invoices accept an `items` array. If the root `amount` is omitted, `total` is automatically summed using line item quantities & rates.

---

### 8. User Actions (Discovery & Reports)

**POST `/users/check-contacts`**
Pass a list of phone numbers; backend returns which are registered Mahajans on the app. Rate limited.

**POST `/users/me/gstin`**
Submit your GSTIN for pending verification.

**POST `/users/:userId/report`**
Report a user (Upsert system). Valid reasons: `SPAM`, `FRAUD`, `HARASSMENT`, `FAKE_ACCOUNT`, `OTHER`.

---

## Error Format Matrix (Zod Example)

| HTTP | Error Type | Condition |
|------|-----------|-----------|
| `400` | ValidationError | Invalid input/Zod schema failure |
| `401` | UnauthorizedError | Token missing/invalid/expired |
| `403` | ForbiddenError | Not in org, insufficient role |
| `404` | NotFoundError | Resource doesn't exist |
| `409` | ConflictError | Duplicate data (e.g., phone exists) |

```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    { "path": ["phones"], "message": "At least 1 phone number required" }
  ]
}
```
