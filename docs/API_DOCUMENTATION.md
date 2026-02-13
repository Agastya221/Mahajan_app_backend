# Mahajan Network Platform — API Documentation

**Base URL:** `http://localhost:3000/api/v1`  
**Version:** 2.0  
**Last Updated:** 2026-02-13

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Organizations](#2-organizations)
3. [Users](#3-users)
4. [Drivers](#4-drivers)
5. [Trucks](#5-trucks)
6. [Items](#6-items)
7. [Trips](#7-trips)
8. [Tracking](#8-tracking)
9. [Ledger](#9-ledger)
10. [Chat](#10-chat)
11. [Files](#11-files)
12. [Exports](#12-exports)
13. [Driver Payments](#13-driver-payments)
14. [Health](#14-health)

---

## Authentication

All authenticated endpoints require `Authorization: Bearer <access_token>` header.

### Token Lifecycle
- **Access Token:** 15 minutes (default)
- **Refresh Token:** 30 days (stored in DB)

---

## 1. Authentication

### 1.1 Get Widget Config
```http
GET /auth/widget-config
```

**Description:** Get MSG91 OTP widget configuration for frontend initialization.

**Auth:** Public

**Response:**
```json
{
  "success": true,
  "data": {
    "widgetId": "...",
    "tokenAuth": "..."
  }
}
```

---

### 1.2 Verify Widget Token
```http
POST /auth/verify-widget-token
```

**Description:** Verify MSG91 OTP token. Returns existing user with tokens OR prompts for registration.

**Auth:** Public

**Request Body:**
```json
{
  "accessToken": "widget_access_token_from_msg91"
}
```

**Response (Existing User):**
```json
{
  "success": true,
  "isNewUser": false,
  "user": {
    "id": "...",
    "name": "...",
    "phone": "+919876543210",
    "role": "MAHAJAN"
  },
  "tokens": {
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

**Response (New User):**
```json
{
  "success": true,
  "isNewUser": true,
  "phone": "+919876543210",
  "verificationToken": "...",
  "message": "Phone verified. Complete registration to create your account."
}
```

---

### 1.3 Register
```http
POST /auth/register
```

**Description:** Complete registration for new users.

**Auth:** Public (requires verificationToken from verify-widget-token)

**Request Body:**
```json
{
  "verificationToken": "...",
  "name": "Rajesh Kumar",
  "role": "MAHAJAN"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "Rajesh Kumar",
    "phone": "+919876543210",
    "role": "MAHAJAN"
  },
  "tokens": {
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

---

### 1.4 Refresh Token
```http
POST /auth/refresh
```

**Description:** Refresh access token using refresh token (implements token rotation).

**Auth:** Public

**Request Body:**
```json
{
  "refreshToken": "..."
}
```

**Response:**
```json
{
  "success": true,
  "tokens": {
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

---

### 1.5 Logout
```http
POST /auth/logout
```

**Description:** Logout user (blacklists access token + revokes refresh token).

**Auth:** Private

**Request Body:**
```json
{
  "refreshToken": "..." // optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## 2. Organizations

### 2.1 Create Organization
```http
POST /orgs
```

**Auth:** Private

**Request Body:**
```json
{
  "name": "Kumar Traders",
  "city": "Delhi",
  "phone": "+919876543210",
  "address": "Azadpur Mandi, Delhi",
  "gstin": "07AABCU9603R1ZV",
  "roleType": "SOURCE_COLLECTOR"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Kumar Traders",
    "city": "Delhi",
    "roleType": "SOURCE_COLLECTOR",
    "createdAt": "2026-02-13T07:46:23.000Z"
  }
}
```

---

### 2.2 Get User's Organizations
```http
GET /orgs
```

**Auth:** Private

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "Kumar Traders",
      "city": "Delhi",
      "memberCount": 1,
      "truckCount": 5
    }
  ]
}
```

---

### 2.3 Search Organizations
```http
GET /orgs/search?query=kumar
```

**Auth:** Private

**Query Params:**
- `query` (required): Search term

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "Kumar Traders",
      "city": "Delhi",
      "phone": "+919876543210",
      "ownerName": "Rajesh Kumar",
      "displayLabel": "Kumar Traders (Delhi) - Rajesh Kumar"
    }
  ]
}
```

---

### 2.4 Get Organization by ID
```http
GET /orgs/:orgId
```

**Auth:** Private (must be org member)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Kumar Traders",
    "city": "Delhi",
    "members": [...],
    "trucks": [...]
  }
}
```

---

### 2.5 Update Organization
```http
PATCH /orgs/:orgId
```

**Auth:** Private (owner only)

**Request Body:**
```json
{
  "name": "Kumar Traders Pvt Ltd",
  "city": "New Delhi"
}
```

---

### 2.6 Delete Organization
```http
DELETE /orgs/:orgId
```

**Auth:** Private (owner only)

---

## 3. Users

### 3.1 Submit GSTIN
```http
POST /users/me/gstin
```

**Auth:** Private (MAHAJAN only)

**Request Body:**
```json
{
  "gstin": "07AABCU9603R1ZV"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "gstin": "07AABCU9603R1ZV",
    "isVerified": false
  }
}
```

---

### 3.2 Get GSTIN Status
```http
GET /users/me/gstin
```

**Auth:** Private

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "gstin": "07AABCU9603R1ZV",
    "isVerified": true
  }
}
```

---

## 4. Drivers

### 4.1 Create Driver
```http
POST /drivers
```

**Auth:** Private

**Request Body:**
```json
{
  "userId": "user_id_with_DRIVER_role",
  "licenseNo": "DL1420110012345",
  "emergencyPhone": "+919876543210",
  "notes": "Experienced driver",
  "deviceId": "device_unique_id"
}
```

---

### 4.2 List Drivers
```http
GET /drivers?phone=9876&page=1&limit=20
```

**Auth:** Private

**Query Params:**
- `phone` (optional): Filter by phone
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20, max: 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "drivers": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

---

### 4.3 Get Driver by ID
```http
GET /drivers/:driverId
```

**Auth:** Private

---

### 4.4 Update Driver
```http
PATCH /drivers/:driverId
```

**Auth:** Private

---

### 4.5 Delete Driver
```http
DELETE /drivers/:driverId
```

**Auth:** Private (blocked if active trips exist)

---

## 5. Trucks

### 5.1 Create Truck
```http
POST /trucks
```

**Auth:** Private (org member)

**Request Body:**
```json
{
  "orgId": "...",
  "number": "DL1CAB1234",
  "type": "TATA ACE",
  "capacity": 1500
}
```

---

### 5.2 List Trucks
```http
GET /trucks?orgId=...&page=1&limit=20
```

**Auth:** Private

---

### 5.3 Get Truck by ID
```http
GET /trucks/:truckId
```

**Auth:** Private

---

### 5.4 Update Truck
```http
PATCH /trucks/:truckId
```

**Auth:** Private (org member)

---

### 5.5 Delete Truck
```http
DELETE /trucks/:truckId
```

**Auth:** Private (org member, blocked if active trips)

---

## 6. Items

### 6.1 Create Item
```http
POST /items/:orgId
```

**Auth:** Private (org member)

**Request Body:**
```json
{
  "name": "Kinnaur Apple",
  "nameHindi": "किन्नौर सेब",
  "category": "Fruit",
  "hsn": "08081000",
  "defaultUnit": "KG",
  "defaultCustomUnit": null
}
```

---

### 6.2 List Items
```http
GET /items/:orgId?search=apple&category=Fruit&includeInactive=false&page=1&limit=20
```

**Auth:** Private (org member)

**Query Params:**
- `search` (optional): Search in name/nameHindi
- `category` (optional): Filter by category
- `includeInactive` (optional): Include inactive items
- `page`, `limit`: Pagination

---

### 6.3 Get Categories
```http
GET /items/:orgId/categories
```

**Auth:** Private (org member)

**Response:**
```json
{
  "success": true,
  "data": ["Fruit", "Vegetable", "Packaging"]
}
```

---

### 6.4 Get Item by ID
```http
GET /items/:orgId/:itemId
```

**Auth:** Private (org member)

---

### 6.5 Update Item
```http
PATCH /items/:orgId/:itemId
```

**Auth:** Private (org member)

---

### 6.6 Delete Item (Soft Delete)
```http
DELETE /items/:orgId/:itemId
```

**Auth:** Private (org member)

---

## 7. Trips

### 7.1 Create Trip
```http
POST /trips
```

**Auth:** Private

**Request Body:**
```json
{
  "sourceOrgId": "...",
  "destinationOrgId": "...",
  "truckId": "...",
  "driverId": "...",
  "pendingDriverPhone": "+919876543210",
  "startPoint": "Azadpur Mandi",
  "endPoint": "Okhla Market",
  "notes": "Handle with care"
}
```

---

### 7.2 List Trips
```http
GET /trips?orgId=...&status=IN_TRANSIT&page=1&limit=20
```

**Auth:** Private

**Query Params:**
- `orgId` (optional): Filter by source or destination org
- `status` (optional): Filter by TripStatus
- `page`, `limit`: Pagination

---

### 7.3 Get Trip by ID
```http
GET /trips/:tripId
```

**Auth:** Private

**Response:** Full trip details with loadCard, receiveCard, events, locations, payments, etc.

---

### 7.4 Update Trip Status
```http
PATCH /trips/:tripId/status
```

**Auth:** Private

**Request Body:**
```json
{
  "status": "IN_TRANSIT",
  "notes": "Left warehouse at 10 AM"
}
```

---

### 7.5 Create Load Card
```http
POST /trips/:tripId/load-card
```

**Auth:** Private (source org member only)

**Request Body:**
```json
{
  "loadedAt": "2026-02-13T10:00:00Z",
  "remarks": "All items checked",
  "items": [
    {
      "itemId": "...",
      "itemName": "Potato",
      "itemNameHindi": "आलू",
      "quantity": 50,
      "unit": "BAG",
      "rate": 40.00,
      "amount": 2000.00,
      "grade": "A",
      "remarks": "Fresh stock"
    }
  ]
}
```

**Response:** Auto-calculates `totalItems`, `totalQuantity`, `totalAmount`. Updates trip status to `LOADED`. Posts `TRIP_CARD` to chat.

---

### 7.6 Create Receive Card
```http
POST /trips/:tripId/receive-card
```

**Auth:** Private (destination org member only)

**Request Body:**
```json
{
  "receivedAt": "2026-02-13T18:00:00Z",
  "remarks": "2 bags damaged",
  "items": [
    {
      "loadItemId": "...",
      "itemId": "...",
      "itemName": "Potato",
      "quantity": 48,
      "unit": "BAG",
      "rate": 40.00,
      "amount": 1920.00,
      "qualityIssue": "Damaged",
      "remarks": "2 bags wet"
    }
  ]
}
```

**Response:** Auto-calculates `shortage` (50 - 48 = 2), `shortagePercent` (4%). Updates trip status to `DELIVERED`. Posts `SHORTAGE_ALERT` to chat if shortage > 0.

---

## 8. Tracking

### 8.1 Submit GPS Pings (Batch)
```http
POST /tracking/ping
```

**Auth:** Private (DRIVER only)

**Request Body:**
```json
{
  "tripId": "...",
  "locations": [
    {
      "lat": 28.7041,
      "lng": 77.1025,
      "speed": 45.5,
      "heading": 180,
      "accuracy": 10,
      "capturedAt": "2026-02-13T12:00:00Z"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "5 locations queued for processing"
}
```

**Notes:**
- Rate limited: 10 requests/min per IP
- Locations stored in PostgreSQL (1 per 30s per trip)
- Real-time broadcast via Socket.IO to `trip:${tripId}` room

---

### 8.2 Get Location History
```http
GET /tracking/trips/:tripId/locations?limit=100&offset=0
```

**Auth:** Private

---

### 8.3 Get Latest Location
```http
GET /tracking/trips/:tripId/latest
```

**Auth:** Private

**Response:**
```json
{
  "success": true,
  "data": {
    "lat": 28.7041,
    "lng": 77.1025,
    "speed": 45.5,
    "capturedAt": "2026-02-13T12:30:00Z"
  }
}
```

---

### 8.4 Get Active Trips for Driver
```http
GET /tracking/drivers/:driverId/active-trips
```

**Auth:** Private (DRIVER only)

---

## 9. Ledger

### 9.1 Create/Get Account
```http
POST /ledger/accounts
```

**Auth:** Private

**Request Body:**
```json
{
  "ownerOrgId": "...",
  "counterpartyOrgId": "..."
}
```

**Response:** Returns existing account or creates new one with `balance: 0`.

---

### 9.2 List Accounts
```http
GET /ledger/accounts?orgId=...&page=1&limit=20
```

**Auth:** Private

---

### 9.3 Get Account by ID
```http
GET /ledger/accounts/:accountId
```

**Auth:** Private

---

### 9.4 Get Ledger Timeline
```http
GET /ledger/accounts/:accountId/timeline?limit=50&offset=0
```

**Auth:** Private

**Response:**
```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "...",
        "direction": "RECEIVABLE",
        "amount": 50000,
        "balance": 50000,
        "description": "Invoice #INV-001",
        "createdAt": "2026-02-13T10:00:00Z"
      }
    ],
    "pagination": {...}
  }
}
```

---

### 9.5 Create Invoice
```http
POST /ledger/invoices
```

**Auth:** Private

**Request Body:**
```json
{
  "accountId": "...",
  "tripId": "...",
  "total": 50000,
  "dueDate": "2026-03-13",
  "description": "Trip payment for DL1CAB1234"
}
```

**Response:** Auto-generates `invoiceNumber`, creates `LedgerEntry`, updates `Account.balance`, posts `INVOICE_CARD` to chat.

---

### 9.6 List Invoices
```http
GET /ledger/accounts/:accountId/invoices?page=1&limit=20
```

**Auth:** Private

---

### 9.7 Update Invoice
```http
PATCH /ledger/invoices/:invoiceId
```

**Auth:** Private

---

### 9.8 Create Payment Request
```http
POST /ledger/payments/request
```

**Auth:** Private (receiver creates)

**Request Body:**
```json
{
  "accountId": "...",
  "amount": 25000,
  "mode": "UPI",
  "tag": "PARTIAL",
  "remarks": "First installment"
}
```

**Response:** Creates payment with `status: PENDING`. Posts `PAYMENT_REQUEST` card to chat (🔔 ₹25,000 requested).

---

### 9.9 Mark Payment as Paid
```http
POST /ledger/payments/mark-paid
```

**Auth:** Private (sender marks)

**Request Body:**
```json
{
  "paymentId": "...",
  "mode": "UPI",
  "utrNumber": "123456789012",
  "proofNote": "Paid via Google Pay"
}
```

**Response:** Updates to `status: MARKED_AS_PAID`. Posts card (💸 ₹25,000 marked as paid via UPI).

**Note:** Ledger balance NOT updated yet.

---

### 9.10 Confirm Payment
```http
POST /ledger/payments/confirm
```

**Auth:** Private (receiver confirms)

**Request Body:**
```json
{
  "paymentId": "..."
}
```

**Response:** Updates to `status: CONFIRMED`. **NOW** creates `LedgerEntry` and updates `Account.balance`. Posts card (✅ ₹25,000 confirmed).

---

### 9.11 Dispute Payment
```http
POST /ledger/payments/dispute
```

**Auth:** Private (receiver disputes)

**Request Body:**
```json
{
  "paymentId": "...",
  "disputeReason": "Amount not received in bank"
}
```

**Response:** Updates to `status: DISPUTED`. Ledger balance NOT updated. Posts card (⚠️ ₹25,000 disputed).

---

### 9.12 Get Pending Payments
```http
GET /ledger/accounts/:accountId/pending-payments
```

**Auth:** Private

**Response:** Returns payments with `status: PENDING` or `MARKED_AS_PAID`.

---

### 9.13 Get Payment by ID
```http
GET /ledger/payments/:paymentId
```

**Auth:** Private

---

### 9.14 Record Payment (Legacy/Direct)
```http
POST /ledger/payments
```

**Auth:** Private

**Note:** Direct payment recording (skips two-party confirmation). Creates payment with `status: CONFIRMED` immediately.

---

### 9.15 List Payments
```http
GET /ledger/accounts/:accountId/payments?page=1&limit=20
```

**Auth:** Private

---

## 10. Chat

### 10.1 Create/Get Thread
```http
POST /chat/threads
```

**Auth:** Private

**Request Body:**
```json
{
  "accountId": "...",
  "tripId": "..."
}
```

**Note:** Provide either `accountId` OR `tripId` (not both). Returns existing thread or creates new one.

---

### 10.2 List Threads
```http
GET /chat/threads?accountId=...&tripId=...&page=1&limit=20
```

**Auth:** Private

---

### 10.3 Get Thread by ID
```http
GET /chat/threads/:threadId
```

**Auth:** Private

---

### 10.4 Get Messages
```http
GET /chat/threads/:threadId/messages?limit=50&offset=0
```

**Auth:** Private

**Response:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "...",
        "content": "Payment received",
        "messageType": "TEXT",
        "senderUser": {...},
        "createdAt": "2026-02-13T12:00:00Z",
        "isRead": false
      }
    ],
    "pagination": {...}
  }
}
```

---

### 10.5 Send Message
```http
POST /chat/threads/:threadId/messages
```

**Auth:** Private

**Request Body:**
```json
{
  "content": "Payment sent via UPI",
  "messageType": "TEXT"
}
```

---

### 10.6 Mark as Read
```http
POST /chat/threads/:threadId/read
```

**Auth:** Private

---

### 10.7 Mark as Delivered
```http
POST /chat/threads/:threadId/delivered
```

**Auth:** Private

---

### 10.8 Pin/Unpin Thread
```http
POST /chat/threads/:threadId/pin
```

**Auth:** Private

**Request Body:**
```json
{
  "isPinned": true
}
```

---

### 10.9 Archive/Unarchive Thread
```http
POST /chat/threads/:threadId/archive
```

**Auth:** Private

**Request Body:**
```json
{
  "isArchived": true
}
```

---

### 10.10 Get Unread Counts
```http
GET /chat/unread
```

**Auth:** Private

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "threadId": "...",
      "unreadCount": 5
    }
  ]
}
```

---

### 10.11 Search Messages
```http
GET /chat/search?orgId=...&query=payment
```

**Auth:** Private

---

### 10.12 Perform Action (Rich Actions)
```http
POST /chat/threads/:threadId/action
```

**Auth:** Private

**Request Body (Create Trip):**
```json
{
  "actionType": "CREATE_TRIP",
  "payload": {
    "truckId": "...",
    "driverId": "...",
    "startPoint": "Delhi",
    "endPoint": "Mumbai"
    // sourceOrgId & destinationOrgId are OPTIONAL
    // If creating from account-based chat, they are auto-detected!
  }
}
```

**Request Body (Create Trip - Manual Mode):**
```json
{
  "actionType": "CREATE_TRIP",
  "payload": {
    "sourceOrgId": "...",      // Optional - auto-detected from chat thread
    "destinationOrgId": "...", // Optional - auto-detected from chat thread
    "truckId": "...",
    "driverId": "...",
    "startPoint": "Delhi",
    "endPoint": "Mumbai"
  }
}
```

**✨ Smart Auto-Detection:**
- When creating trip from **account-based chat thread**, `sourceOrgId` and `destinationOrgId` are automatically extracted from the account relationship
- `sourceOrgId` = `account.ownerOrgId`
- `destinationOrgId` = `account.counterpartyOrgId`
- You can still manually provide these IDs to override auto-detection


**Request Body (Request Payment):**
```json
{
  "actionType": "REQUEST_PAYMENT",
  "payload": {
    "accountId": "...",
    "amount": 50000,
    "mode": "UPI",
    "tag": "ADVANCE"
  }
}
```

**Request Body (Share Data Grid):**
```json
{
  "actionType": "SHARE_DATA_GRID",
  "payload": {
    "title": "Trip Summary",
    "rows": [
      {"Date": "2026-02-13", "Amount": "₹50,000"}
    ]
  }
}
```

**Supported Actions:**
- `CREATE_TRIP`
- `REQUEST_PAYMENT`
- `MARK_PAYMENT_PAID`
- `CONFIRM_PAYMENT`
- `DISPUTE_PAYMENT`
- `CREATE_INVOICE`
- `SHARE_DATA_GRID`
- `SHARE_LEDGER_TIMELINE`

---

## 11. Files

### 11.1 Request Presigned Upload URL
```http
POST /files/presigned-url
```

**Auth:** Private

**Request Body:**
```json
{
  "filename": "invoice.pdf",
  "mimeType": "application/pdf",
  "purpose": "INVOICE"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fileId": "...",
    "uploadUrl": "https://s3.amazonaws.com/...",
    "s3Key": "documents/invoices/2026/02/uuid.pdf"
  }
}
```

---

### 11.2 Confirm Upload
```http
POST /files/confirm-upload
```

**Auth:** Private

**Request Body:**
```json
{
  "fileId": "...",
  "s3Key": "..."
}
```

---

### 11.3 Upload with Server-Side Compression
```http
POST /files/upload-compressed
```

**Auth:** Private

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `file`: File to upload
- `filename` (optional): Override filename
- `mimeType` (optional): Override MIME type
- `purpose` (optional): LOAD_CARD | RECEIVE_CARD | INVOICE | CHAT_ATTACHMENT
- `skipCompression` (optional): Set to 'true' to skip compression

**Response:**
```json
{
  "success": true,
  "data": {
    "fileId": "...",
    "url": "https://...",
    "originalSize": 2048000,
    "compressedSize": 307200,
    "compressionRatio": "85%"
  }
}
```

---

### 11.4 Get Download URL
```http
GET /files/:fileId/download-url
```

**Auth:** Private

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://s3.amazonaws.com/...",
    "expiresIn": 3600
  }
}
```

---

### 11.5 Get File Metadata
```http
GET /files/:fileId
```

**Auth:** Private

---

### 11.6 Delete File
```http
DELETE /files/:fileId
```

**Auth:** Private

---

## 12. Exports

### 12.1 Generate Export
```http
POST /exports/:orgId
```

**Auth:** Private (org member)

**Request Body:**
```json
{
  "exportType": "TRIPS",
  "format": "XLSX",
  "startDate": "2026-01-01",
  "endDate": "2026-02-13",
  "counterpartyOrgId": "...",
  "filters": {
    "status": "COMPLETED"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "exportId": "...",
    "downloadUrl": "https://s3.amazonaws.com/...",
    "fileName": "trips_export_2026-02-13.xlsx",
    "rowCount": 150,
    "expiresAt": "2026-02-20T00:00:00Z"
  }
}
```

---

### 12.2 Get Export History
```http
GET /exports/:orgId/history
```

**Auth:** Private (org member)

---

## 13. Driver Payments

### 13.1 Create/Update Driver Payment Terms
```http
POST /trips/:tripId/driver-payment
```

**Auth:** Private (source or destination org member)

**Request Body:**
```json
{
  "totalAmount": 5000,
  "paidBy": "SOURCE",
  "remarks": "Advance payment"
}
```

**Request Body (Split):**
```json
{
  "totalAmount": 5000,
  "paidBy": "SPLIT",
  "splitSourceAmount": 3000,
  "splitDestAmount": 2000,
  "remarks": "Split 60-40"
}
```

---

### 13.2 Record Driver Payment
```http
POST /trips/:tripId/driver-payment/record
```

**Auth:** Private (source or destination org member)

**Request Body:**
```json
{
  "amount": 2000,
  "remarks": "Partial payment"
}
```

**Response:** Auto-updates `paidAmount` and `status` (PENDING → PARTIALLY_PAID → PAID).

---

### 13.3 Get Driver Payment Status
```http
GET /trips/:tripId/driver-payment
```

**Auth:** Private (source or destination org member)

---

### 13.4 List Pending Driver Payments
```http
GET /orgs/:orgId/pending-driver-payments
```

**Auth:** Private (org member)

---

## 14. Health

### 14.1 Health Check
```http
GET /health
```

**Auth:** Public

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-02-13T13:16:23.000Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

---

## Error Responses

All endpoints follow a consistent error format:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid/missing token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 409 | Conflict (duplicate resource) |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

---

## Rate Limits

| Endpoint Pattern | Window | Max Requests |
|-----------------|--------|-------------|
| `/api/*` | 15 min | 100/IP |
| `/auth/verify-widget-token` | 15 min | 20/IP |
| `/auth/refresh` | 15 min | 30/IP |
| `/tracking/ping` | 1 min | 10/IP |

---

## WebSocket Events

Connect to `ws://localhost:3000` with JWT auth:

```javascript
const socket = io('ws://localhost:3000', {
  auth: { token: accessToken }
});
```

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `join:org` | `orgId` | Join org notification room |
| `join:trip` | `tripId` | Join trip tracking room |
| `join:chat` | `threadId` | Join chat thread room |
| `join:account` | `accountId` | Join account updates room |
| `typing` | `{ threadId }` | Broadcast typing indicator |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `new:message` | `ChatMessage` | New chat message |
| `location:update` | `{ tripId, lat, lng, ... }` | Real-time GPS update |
| `trip:status` | `{ tripId, status }` | Trip status changed |
| `payment:update` | `Payment` | Payment status changed |

---

**End of API Documentation**
