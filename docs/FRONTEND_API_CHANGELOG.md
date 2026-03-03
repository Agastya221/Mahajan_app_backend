# 🔄 Backend Changes — March 2, 2026

> **For**: Frontend / React Native developers
> **Date**: 2026-03-02
> **Breaking changes**: None — all changes are additive

---

## 1️⃣ NEW: Contact Discovery Endpoint

### `POST /api/v1/users/check-contacts`

**Purpose**: Check which of the user's phone contacts are registered Mahajans on the platform. Use this on the "Add Mahajan" screen to show which contacts are already on the app.

**Auth**: Required (Bearer token)
**Rate Limit**: 10 requests per minute (dedicated limiter, separate from global)

#### Request

```json
POST /api/v1/users/check-contacts
Authorization: Bearer <token>
Content-Type: application/json

{
  "phones": [
    "+916202923165",
    "+919006412619",
    "+919999999999",
    "+919823456789"
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `phones` | `string[]` | ✅ | Min 1, Max 500 phone numbers |

#### Response

```json
{
  "success": true,
  "data": {
    "registeredUsers": [
      {
        "id": "clx1abc...",
        "name": "Agastya Mahajan",
        "phone": "+916202923165",
        "status": "ACTIVE",
        "isVerified": true,
        "org": {
          "id": "clx2def...",
          "name": "Mahajan Fruits & Vegetables, Nashik",
          "city": "Nashik"
        }
      },
      {
        "id": "clx3ghi...",
        "name": "Javed Shaikh",
        "phone": "+919006412619",
        "status": "SUSPENDED",
        "isVerified": false,
        "org": {
          "id": "clx4jkl...",
          "name": "Shaikh Trading Co., Vashi",
          "city": "Navi Mumbai"
        }
      }
    ]
  }
}
```

#### Response Fields

| Field | Type | Values | What to show |
|---|---|---|---|
| `status` | `string` | `"ACTIVE"` | ✅ Normal — green dot, allow interaction |
| | | `"SUSPENDED"` | ⚠️ Show "Account Suspended" label, grey out |
| | | `"BANNED"` | 🚫 Show "Account Banned" label, disable interaction |
| `isVerified` | `boolean` | `true` / `false` | Show GST verified badge (✓) if true |
| `org` | `object \| null` | — | May be `null` if user hasn't created an org yet |

#### Frontend Usage

```typescript
// React Native — on "Add Mahajan" screen mount
const contacts = await Contacts.getAll(); // from device
const phones = contacts
  .flatMap(c => c.phoneNumbers.map(p => p.number))
  .filter(Boolean);

const { data } = await api.post('/users/check-contacts', { phones });

// data.registeredUsers → show with green "On Platform" badge
// Contacts NOT in registeredUsers → show "Invite" button
// status === "SUSPENDED" → show ⚠️ warning, grey out
// status === "BANNED"    → show 🚫 badge, disable
```

#### Important Notes

- **Response has ~100ms artificial delay** — this is intentional (anti-enumeration security). Don't treat it as a bug.
- **Only returns Mahajans** — drivers are excluded from results.
- **Phone normalization** is handled server-side (strips spaces, dashes, parentheses). Send raw phone strings.
- **Unregistered phones are NOT returned** — only matches appear in `registeredUsers`. Compare against your original list to find who to invite.

---

## 2️⃣ NEW: Counterparty Account Status in Chat

Every chat thread now includes a `counterpartyStatus` field that tells you if the other party's account is active, suspended, or banned.

### Where it appears

| Endpoint | Field added |
|---|---|
| `GET /api/v1/chat/threads` (thread list) | Each thread now has `counterpartyStatus` |
| `GET /api/v1/chat/threads/:threadId` (single thread) | Thread now has `counterpartyStatus` |

### Shape

```json
{
  "id": "thread_abc123",
  "org": { ... },
  "counterpartyOrg": { ... },
  "unreadCount": 3,

  "counterpartyStatus": {
    "status": "ACTIVE",
    "message": null
  }
}
```

Or when banned/suspended:

```json
{
  "counterpartyStatus": {
    "status": "SUSPENDED",
    "message": "Violation of terms of service"
  }
}

{
  "counterpartyStatus": {
    "status": "BANNED",
    "message": "Account permanently banned for fraud"
  }
}
```

### Frontend Usage

| `counterpartyStatus.status` | What to show in chat |
|---|---|
| `"ACTIVE"` | Normal chat — no banner needed |
| `"SUSPENDED"` | ⚠️ Show yellow banner at top of chat: *"This account has been suspended"* + optional `message` reason. Allow reading messages, but consider disabling send. |
| `"BANNED"` | 🚫 Show red banner: *"This account has been banned"* + optional `message` reason. Disable sending new messages. |

### Suggested UI

```
┌──────────────────────────────────┐
│ ⚠️ This account has been         │
│    suspended                     │
│    Reason: Violation of terms    │
├──────────────────────────────────┤
│                                  │
│  Chat messages here...           │
│                                  │
├──────────────────────────────────┤
│  💬 [Message input - disabled]   │
└──────────────────────────────────┘
```

### How it's determined

The backend checks **all members** of the counterparty org:
- If **every member** is banned → `"BANNED"`
- If **every member** is suspended or banned (nobody active) → `"SUSPENDED"`
- If **at least one member** is active → `"ACTIVE"`

This means if an org has 2 members and only 1 is suspended, the org still shows as `"ACTIVE"` (the other member can still respond).

---

## 3️⃣ WebSocket — No Changes

The Socket.IO gateway is **unchanged**. Existing events work exactly as before:

| Event | Direction | Status |
|---|---|---|
| `chat:message` | Server → Client | ✅ Unchanged |
| `chat:read` | Server → Client | ✅ Unchanged |
| `chat:delivered` | Server → Client | ✅ Unchanged |
| `tracking:location-update` | Server → Client | ✅ Unchanged |
| `trip:status-update` | Server → Client | ✅ Unchanged |
| `chat:join` / `chat:leave` | Client → Server | ✅ Unchanged |
| `tracking:subscribe` / `unsubscribe` | Client → Server | ✅ Unchanged |

> **Note**: The socket middleware already blocks suspended/banned users from connecting (returns `"Account has been suspended or banned"` error). This was already implemented before today's changes.

---

## 4️⃣ Seed File Fix

The `prisma/seed.ts` file had a bug — it was setting a `title` field on `ChatThread` which doesn't exist in the schema. This caused `npm run prisma:seed` to fail. **Fixed** — seed now runs cleanly.

---

## Summary

| Change | Type | Breaking? |
|---|---|---|
| `POST /users/check-contacts` | New endpoint | ❌ No |
| `counterpartyStatus` on chat threads | New field on existing response | ❌ No (additive) |
| WebSocket gateway | No changes | ❌ No |
| Seed file fix | Bug fix | ❌ No |

#  Backend Changes — March 3, 2026

> **For**: Frontend / React Native developers
> **Date**: 2026-03-03
> **Breaking changes**: YES  (Driver Payment Amount formats)

---

## 1 BREAKING : Driver Payment Amounts are now in PAISE

All DriverPayment endpoints now return amounts in **paise** (as strings due to BigInt serialization) instead of floating point rupees. This aligns DriverPayment with Account, Payment, and LedgerEntry which all use paise.

**Affected fields in DriverPayment API responses:**
- 	otalAmount
- paidAmount
- splitSourceAmount
- splitDestAmount

**Old Response:**
`json
{
  "totalAmount": "185.50",
  "paidAmount": "0.00"
}
`

**New Response:**
`json
{
  "totalAmount": "18550", // Divide by 100 on frontend for UI UI (rs. 185.50)
  "paidAmount": "0" 
}
`

> **Note on sending data:** When creating a trip or driver payment, you can *still send the amount in Rupees* as a standard number ("driverPaymentAmount": 185.50). The backend mathematically converts it to paise securely. However, the exact data sent from the backend to the frontend will be returned in paise.

---

## 2 NEW: Org Phone Uniqueness

The phone field on Organizations (Org) is now globally @unique. 

**Impact:**
- If you attempt to update or create an Organization using a phone number that is already claimed by another active organization, the API will return a HTTP 400 Validation Error.
- This ensures 1:1 strict parity for our WhatsApp-style directory where phone numbers are the primary lookup keys.

---

## 3 NEW: Invite Expiration

Invites to unregistered Mahajans (MahajanInvite) now have an xpiresAt property. 
- Invites automatically expire **7 days** after being sent.
- If an invite is resent, its xpiresAt is bumped for another 7 days.

---

## 4 NEW: Map System Coordination Schema
*Reference: docs/MAP_SYSTEM_FRONTEND_GUIDE.md*

The database schema has successfully run the migration to store Mapbox route coordinates natively on the Trip table (sourceLat, sourceLng, destLat, destLng, outeDistance, outeDuration), allowing native map polyline generation and tracking. The Map system guide correctly documents all the related endpoints.
