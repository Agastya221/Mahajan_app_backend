# Chat Actions — Low Level Design (LLD)

> **Updated:** 2026-02-13  
> **Status:** Implemented (Backend), Frontend pending

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Schema](#2-database-schema)
3. [Class & Service Architecture](#3-class--service-architecture)
4. [API Contracts](#4-api-contracts)
5. [Sequence Diagrams](#5-sequence-diagrams)
6. [Message Types & Metadata](#6-message-types--metadata)
7. [Real-Time (WebSocket) Flow](#7-real-time-websocket-flow)
8. [Error Handling](#8-error-handling)
9. [Security & Authorization](#9-security--authorization)
10. [Frontend Rendering Guide](#10-frontend-rendering-guide)

---

## 1. System Overview

### 1.1 Core Idea

The chat is the **central nervous system** of the app. Instead of having separate screens for trips, payments, and invoices, users perform all actions **from within the chat** and see results as **rich interactive cards**.

### 1.2 Architecture Pattern

```
┌─────────────────────────────────────────────────────┐
│                      FRONTEND                        │
│   Chat Screen → Action Menu → Form → Submit          │
└──────────────────────┬──────────────────────────────┘
                       │  POST /chat/threads/:id/action
                       │  { actionType, payload }
                       ▼
              ┌─────────────────┐
              │ ChatController  │ ← Single entry point
              │ .performAction()│
              └────────┬────────┘
                       │ switch(actionType)
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
   TripService   LedgerService   ChatService
         │             │              │
         ▼             ▼              ▼
      Prisma DB    Prisma DB    Redis PubSub
                                      │
                                      ▼
                               WebSocket → Frontend
                               (real-time card appears)
```

### 1.3 Key Design Decisions

| Decision | Rationale |
|---|---|
| **Single `/action` endpoint** | Frontend needs only one API. The `actionType` string determines what happens. Simpler than 8 separate routes. |
| **Services auto-post to chat** | Even if someone calls `LedgerService.createPaymentRequest()` directly (e.g., from a different screen), the chat card is still created. No blind spots. |
| **Non-blocking chat posts** | Every chat notification is wrapped in `try-catch`. A Redis failure should never rollback a successful payment. |
| **`metadata` as JSON** | Each card type has different fields. JSON gives flexibility without schema migrations. Frontend reads `messageType` + `metadata` to render. |
| **Two thread types** | `ChatThread.tripId` (per-trip lifecycle) and `ChatThread.accountId` (long-running financial relationship). |

---

## 2. Database Schema

### 2.1 Entity Relationship Diagram

```
                    ┌──────────┐
                    │   Org    │
                    │  (id)    │
                    └────┬─────┘
                         │ 1:N
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌─────────┐ ┌────────┐ ┌────────────┐
         │OrgMember│ │ Trip   │ │  Account   │
         │(userId) │ │(id)    │ │(ownerOrgId,│
         └─────────┘ │        │ │ cptyOrgId) │
                      └───┬────┘ └─────┬──────┘
                          │            │
              ┌───────────┤       ┌────┴───────┐
              ▼           ▼       ▼            ▼
       ┌───────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
       │ LoadCard  │ │ReceiveCard│ │ Invoice │ │ Payment │
       │ (items[]) │ │(items[]) │ │(total)  │ │(amount, │
       └───────────┘ └──────────┘ └─────────┘ │ status) │
                                               └─────────┘
              ┌───────────────┐
              │  ChatThread   │
              │ ─ tripId?     │  ← links to Trip OR Account
              │ ─ accountId?  │
              └──────┬────────┘
                     │ 1:N
                     ▼
              ┌───────────────┐
              │ ChatMessage   │
              │ ─ messageType │  ← TEXT, TRIP_CARD, PAYMENT_REQUEST, etc.
              │ ─ metadata    │  ← JSON blob with card-specific data
              │ ─ paymentId?  │  ← FK to Payment (for payment cards)
              │ ─ invoiceId?  │  ← FK to Invoice (for invoice cards)
              │ ─ ledgerEntryId? │
              └───────────────┘
```

### 2.2 ChatThread Table

```prisma
model ChatThread {
  id        String  @id @default(cuid())
  orgId     String                        // Owner org
  org       Org     @relation(...)

  // A thread is linked to either an Account OR a Trip (or neither for general)
  accountId String? @unique               // ← max 1 thread per account
  tripId    String? @unique               // ← max 1 thread per trip

  title           String?
  type            String  @default("GENERAL")  // GENERAL / TRIP / ACCOUNT
  lastMessageAt   DateTime?
  lastMessageText String?
  unreadCount     Int     @default(0)
  isArchived      Boolean @default(false)
  isPinned        Boolean @default(false)

  messages  ChatMessage[]
}
```

**Key constraints:**
- `@@unique([accountId])` → One thread per account. All payments & invoices between Org A ↔ Org B go into this single thread.
- `@@unique([tripId])` → One thread per trip. All load cards, shortage alerts, status updates for a trip go here.

### 2.3 ChatMessage Table

```prisma
model ChatMessage {
  id           String          @id @default(cuid())
  threadId     String                          // Required
  senderUserId String?                         // null for SYSTEM_MESSAGE
  content      String?                          // Human-readable text
  messageType  ChatMessageType @default(TEXT)   // Enum ↓
  metadata     Json?                            // Card-specific structured data
  tag          PaymentTag?                      // ADVANCE, PARTIAL, FINAL, etc.

  // Foreign keys to business entities (optional, for linking)
  paymentId     String?        // FK → Payment
  invoiceId     String?        // FK → Invoice
  ledgerEntryId String?        // FK → LedgerEntry

  // Read receipts
  isRead      Boolean @default(false)
  readAt      DateTime?
  isDelivered Boolean @default(false)
  deliveredAt DateTime?

  createdAt DateTime @default(now())
}
```

### 2.4 ChatMessageType Enum

```prisma
enum ChatMessageType {
  TEXT              // Regular text message
  IMAGE             // Photo attachment
  PDF               // PDF document
  FILE              // Generic file
  SYSTEM_MESSAGE    // Auto-generated (status updates, shortage alerts, load cards)
  PAYMENT_UPDATE    // (legacy, kept for backward compat)
  INVOICE_UPDATE    // (legacy)
  LOCATION          // GPS location share
  TRIP_CARD         // Rich trip card
  PAYMENT_REQUEST   // GPay-style payment card
  INVOICE_CARD      // Invoice summary card
  DATA_GRID         // Excel-like data table
}
```

### 2.5 Payment Table (relevant fields)

```prisma
model Payment {
  id        String        @id @default(cuid())
  accountId String?                           // Linked to Account
  amount    BigInt                             // Amount in paisa or rupees
  status    PaymentStatus @default(PENDING)    // See state machine below

  mode      String?       // "UPI", "BANK_TRANSFER", "CASH", "CHEQUE"
  tag       PaymentTag?   // ADVANCE, PARTIAL, FINAL, DUE, OTHER

  // Step 2: Sender marks as paid
  markedPaidAt    DateTime?
  markedPaidBy    String?
  utrNumber       String?    // UTR/Transaction reference
  proofNote       String?

  // Step 3a: Receiver confirms
  confirmedAt     DateTime?
  confirmedBy     String?

  // Step 3b: Receiver disputes
  disputedAt      DateTime?
  disputedBy      String?
  disputeReason   String?
}
```

### 2.6 Payment State Machine

```
  ┌─────────────────────────────────────────────┐
  │              PAYMENT LIFECYCLE               │
  │                                              │
  │   PENDING ──────► MARKED_AS_PAID ──┬──► CONFIRMED  ✅
  │     │ (creditor      (debtor marks │    (creditor confirms,
  │     │  requests)      paid + proof)│     ledger updated)
  │     │                              │
  │     │                              └──► DISPUTED  ⚠️
  │     │                                   (creditor disputes,
  │     │                                    no ledger change)
  │     │                                        │
  │     │                                        │ (debtor retries)
  │     ▼                                        ▼
  │   CANCELLED                             back to PENDING
  └─────────────────────────────────────────────┘
```

**Important:** The `Account.balance` is ONLY updated when a payment reaches `CONFIRMED` status. `MARKED_AS_PAID` does NOT touch the ledger — it's just a claim.

---

## 3. Class & Service Architecture

### 3.1 Class Diagram

```
┌──────────────────────────────────────┐
│          ChatController              │
│──────────────────────────────────────│
│ - chatService: ChatService           │
│ - tripService: TripService           │
│ - ledgerService: LedgerService       │
│──────────────────────────────────────│
│ + createThread(req, res)             │
│ + getThreads(req, res)               │
│ + getMessages(req, res)              │
│ + sendMessage(req, res)              │
│ + performAction(req, res) ★          │ ← Main entry point for all actions
│ + markAsRead(req, res)               │
│ + markAsDelivered(req, res)          │
│ + togglePin(req, res)                │
│ + toggleArchive(req, res)            │
│ + searchMessages(req, res)           │
└──────────────────────────────────────┘
                    │ uses
         ┌──────────┼──────────────┐
         ▼          ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ ChatService  │ │ TripService  │ │LedgerService │
│──────────────│ │──────────────│ │──────────────│
│Methods:      │ │Methods:      │ │Methods:      │
│              │ │              │ │              │
│sendMessage() │ │createTrip()  │ │createPayment │
│sendSystem    │ │updateTrip    │ │  Request()   │
│  Message()   │ │  Status()    │ │markPaymentAs │
│sendAccount   │ │createLoad    │ │  Paid()      │
│  SystemMsg() │ │  Card()      │ │confirmPayment│
│sendTripCard()│ │createReceive │ │  ()          │
│sendPayment   │ │  Card()      │ │disputePayment│
│  UpdateCard()│ │              │ │  ()          │
│sendInvoice   │ │ (auto-posts  │ │createInvoice │
│  Card()      │ │  to chat)    │ │  ()          │
│sendDataGrid()│ │              │ │getLedger     │
│              │ │              │ │  Timeline()  │
└──────────────┘ └──────────────┘ └──────────────┘
       │                │                │
       │      (all call ChatService      │
       │       internally to post        │
       │       cards to chat)            │
       ▼                                 ▼
   Redis PubSub                      Prisma DB
   (broadcast)                    (transactions)
```

### 3.2 ChatService Method Signatures

```typescript
class ChatService {
  // ── Core messaging ──
  async sendMessage(threadId: string, data: SendMessageDto, userId: string): Promise<ChatMessage>
  async getMessages(threadId: string, userId: string, limit: number, offset: number): Promise<{messages, total}>

  // ── Trip-based system messages ──
  async sendSystemMessage(
    tripId: string,               // Finds/creates thread by tripId
    content: string,              // Human-readable text
    metadata?: {                  // Structured data for rich rendering
      type: string,
      [key: string]: any
    }
  ): Promise<ChatMessage>

  // ── Account-based system messages ──
  async sendAccountSystemMessage(
    accountId: string,            // Finds/creates thread by accountId
    content: string,
    messageType?: string,         // Default: 'SYSTEM_MESSAGE'
    metadata?: Record<string, any>,
    senderUserId?: string,
    paymentId?: string,           // Links message to Payment record
    invoiceId?: string            // Links message to Invoice record
  ): Promise<ChatMessage>

  // ── High-level card methods ──
  async sendTripCard(threadId: string, trip: any, userId: string): Promise<ChatMessage>

  async sendPaymentUpdateCard(
    accountId: string,
    payment: { id, amount, status, mode?, tag?, utrNumber?, remarks? },
    action: 'REQUESTED' | 'MARKED_PAID' | 'CONFIRMED' | 'DISPUTED',
    senderUserId?: string,
    disputeReason?: string
  ): Promise<ChatMessage>

  async sendInvoiceCard(
    accountId: string,
    invoice: { id, invoiceNumber, total, description?, dueDate? },
    senderUserId: string
  ): Promise<ChatMessage>

  async sendDataGrid(
    threadId: string,
    title: string,
    rows: Record<string, any>[],
    userId: string
  ): Promise<ChatMessage>
}
```

### 3.3 Where Each Service Posts to Chat

| Service Method | Chat Method Called | Card Type | Thread Type |
|---|---|---|---|
| `TripService.createTrip()` | (via controller) `sendTripCard()` | `TRIP_CARD` | Trip thread |
| `TripService.updateTripStatus()` | `sendSystemMessage()` | `SYSTEM_MESSAGE` (meta: `TRIP_STATUS_UPDATE`) | Trip thread |
| `TripService.createLoadCard()` | `sendSystemMessage()` | `SYSTEM_MESSAGE` (meta: `LOAD_CARD`) | Trip thread |
| `TripService.createReceiveCard()` | `sendSystemMessage()` | `SYSTEM_MESSAGE` (meta: `SHORTAGE_ALERT`) | Trip thread |
| `LedgerService.createPaymentRequest()` | `sendPaymentUpdateCard()` | `PAYMENT_REQUEST` | Account thread |
| `LedgerService.markPaymentAsPaid()` | `sendPaymentUpdateCard()` | `PAYMENT_REQUEST` | Account thread |
| `LedgerService.confirmPayment()` | `sendPaymentUpdateCard()` | `PAYMENT_REQUEST` | Account thread |
| `LedgerService.disputePayment()` | `sendPaymentUpdateCard()` | `PAYMENT_REQUEST` | Account thread |
| `LedgerService.createInvoice()` | `sendInvoiceCard()` | `INVOICE_CARD` | Account thread |
| (via controller) `SHARE_DATA_GRID` | `sendDataGrid()` | `DATA_GRID` | Any thread |
| (via controller) `SHARE_LEDGER_TIMELINE` | `sendDataGrid()` | `DATA_GRID` | Any thread |

---

## 4. API Contracts

### 4.1 The Action Endpoint

```
POST /api/v1/chat/threads/:threadId/action
Authorization: Bearer <JWT>
Content-Type: application/json
```

#### Request Body

```json
{
  "actionType": "CREATE_TRIP | REQUEST_PAYMENT | MARK_PAYMENT_PAID | CONFIRM_PAYMENT | DISPUTE_PAYMENT | CREATE_INVOICE | SHARE_DATA_GRID | SHARE_LEDGER_TIMELINE",
  "payload": { /* depends on actionType — see below */ }
}
```

#### Response (all actions)

```json
{
  "success": true,
  "data": { /* result from the underlying service */ }
}
```

### 4.2 Payload per Action Type

#### `CREATE_TRIP`

```json
{
  "actionType": "CREATE_TRIP",
  "payload": {
    "sourceOrgId": "clxxx...",          // required, cuid
    "destinationOrgId": "clyyy...",     // required, cuid
    "truckNumber": "MH12AB1234",       // required
    "driverPhone": "+919876543210",    // required, +91 format
    "startPoint": "Mumbai",            // required
    "endPoint": "Pune",                // required
    "estimatedDistance": 150,           // optional, km
    "estimatedArrival": "2026-02-14T10:00:00Z",  // optional, ISO datetime
    "notes": "Handle with care"        // optional
  }
}
```

**What happens:**
1. `TripService.createTrip()` → Creates Trip, Truck (if new), finds Driver
2. `ChatService.sendTripCard()` → Posts `TRIP_CARD` to the thread
3. Returns the full Trip object

---

#### `REQUEST_PAYMENT`

```json
{
  "actionType": "REQUEST_PAYMENT",
  "payload": {
    "accountId": "clxxx...",     // required — which account (Org A ↔ Org B)
    "amount": 50000,             // required — in rupees (stored as BigInt)
    "tag": "ADVANCE",            // optional: ADVANCE | PARTIAL | FINAL | DUE | OTHER
    "remarks": "For freight",    // optional
    "invoiceId": "clxxx..."      // optional — link to an existing invoice
  }
}
```

**What happens:**
1. `LedgerService.createPaymentRequest()` → Creates Payment (status: `PENDING`)
2. Inside LedgerService: `ChatService.sendPaymentUpdateCard(accountId, payment, 'REQUESTED')`
3. Chat message created with `messageType: PAYMENT_REQUEST`, linked to payment via `paymentId`
4. Returns the Payment object

---

#### `MARK_PAYMENT_PAID`

```json
{
  "actionType": "MARK_PAYMENT_PAID",
  "payload": {
    "paymentId": "clxxx...",       // required — which payment to mark
    "mode": "UPI",                 // required — UPI | BANK_TRANSFER | CASH | CHEQUE
    "utrNumber": "UTR123456789",   // optional — transaction reference
    "proofNote": "Paid via PhonePe", // optional
    "attachmentIds": ["clxxx..."]  // optional — proof images
  }
}
```

**What happens:**
1. `LedgerService.markPaymentAsPaid()` → Updates Payment status to `MARKED_AS_PAID`, sets `markedPaidAt`, `markedPaidBy`, `utrNumber`
2. Inside LedgerService: `ChatService.sendPaymentUpdateCard(accountId, payment, 'MARKED_PAID')`
3. Returns the updated Payment

---

#### `CONFIRM_PAYMENT`

```json
{
  "actionType": "CONFIRM_PAYMENT",
  "payload": {
    "paymentId": "clxxx..."   // required — which payment to confirm
  }
}
```

**What happens:**
1. `LedgerService.confirmPayment()` → In a DB transaction:
   - Updates Payment status to `CONFIRMED`, sets `confirmedAt`, `confirmedBy`
   - Creates `LedgerEntry` (direction: `RECEIVABLE`) on the account
   - Updates `Account.balance` (decreases what's owed)
   - Creates mirror entry on the counterparty's account
2. Inside LedgerService: `ChatService.sendPaymentUpdateCard(accountId, payment, 'CONFIRMED')`
3. Returns `{ payment, ledgerEntry }`

---

#### `DISPUTE_PAYMENT`

```json
{
  "actionType": "DISPUTE_PAYMENT",
  "payload": {
    "paymentId": "clxxx...",          // required
    "reason": "Amount not received"   // required — why disputed
  }
}
```

**What happens:**
1. `LedgerService.disputePayment()` → Updates Payment status to `DISPUTED`, sets `disputedAt`, `disputedBy`, `disputeReason`
2. **NO ledger entry created** — balance NOT affected
3. Inside LedgerService: `ChatService.sendPaymentUpdateCard(accountId, payment, 'DISPUTED', userId, reason)`
4. Returns the updated Payment

---

#### `CREATE_INVOICE`

```json
{
  "actionType": "CREATE_INVOICE",
  "payload": {
    "accountId": "clxxx...",              // required
    "invoiceNumber": "INV-2026-001",      // required, unique per account
    "amount": 100000,                      // required (in rupees, stored as BigInt)
    "description": "Freight charges Feb",  // optional
    "dueDate": "2026-03-15T00:00:00Z",    // optional
    "attachmentIds": ["clxxx..."]          // optional
  }
}
```

**What happens:**
1. `LedgerService.createInvoice()` → Creates Invoice + LedgerEntry (direction: `PAYABLE`)
2. Updates `Account.balance` (increases what's owed)
3. Inside LedgerService: `ChatService.sendInvoiceCard(accountId, invoice, userId)`
4. Returns the Invoice object

---

#### `SHARE_DATA_GRID`

```json
{
  "actionType": "SHARE_DATA_GRID",
  "payload": {
    "title": "Product Price List",
    "rows": [
      { "Product": "Tomatoes", "Qty": "500 KG", "Rate": "₹40", "Amount": "₹20,000" },
      { "Product": "Onions",   "Qty": "300 KG", "Rate": "₹30", "Amount": "₹9,000"  }
    ]
  }
}
```

**What happens:**
1. `ChatService.sendDataGrid()` → Creates message with `messageType: DATA_GRID`, `metadata.rows` + `metadata.columns`
2. Returns `{ success: true }`

---

#### `SHARE_LEDGER_TIMELINE`

```json
{
  "actionType": "SHARE_LEDGER_TIMELINE",
  "payload": {
    "accountId": "clxxx..."   // required
  }
}
```

**What happens:**
1. Controller calls `LedgerService.getLedgerTimeline(accountId, userId, 20, 0)` → Reads last 20 ledger entries
2. Formats entries into rows: `{ Date, Description, Direction, Amount, Balance }`
3. `ChatService.sendDataGrid(threadId, 'Ledger Timeline', rows, userId)`
4. Returns `{ success: true, entries: count }`

---

## 5. Sequence Diagrams

### 5.1 Full Payment Flow (GPay-like)

```
Frontend          ChatController       LedgerService         ChatService           DB               Redis/WS
   │                    │                    │                     │                 │                    │
   │ REQUEST_PAYMENT    │                    │                     │                 │                    │
   ├───────────────────►│                    │                     │                 │                    │
   │                    │ createPaymentReq() │                     │                 │                    │
   │                    ├───────────────────►│                     │                 │                    │
   │                    │                    │ INSERT Payment      │                 │                    │
   │                    │                    │ (status:PENDING)    │                 │                    │
   │                    │                    ├────────────────────────────────────────►                    │
   │                    │                    │                     │                 │                    │
   │                    │                    │ sendPaymentUpdateCard('REQUESTED')    │                    │
   │                    │                    ├────────────────────►│                 │                    │
   │                    │                    │                     │ findThread(acct)│                    │
   │                    │                    │                     ├────────────────►│                    │
   │                    │                    │                     │ INSERT Message  │                    │
   │                    │                    │                     │ type:PAYMENT_REQ│                    │
   │                    │                    │                     ├────────────────►│                    │
   │                    │                    │                     │                 │                    │
   │                    │                    │                     │ redis.publish() │                    │
   │                    │                    │                     ├───────────────────────────────────────►
   │                    │                    │                     │                 │                    │
   │◄───────────────────┤ { payment }        │                     │                 │     WS push to     │
   │  { success, data } │                    │                     │                 │     other user      │
   │                    │                    │                     │                 │                    │

   ... (later, other user opens chat, sees 🔔 Request card) ...

   │ MARK_PAYMENT_PAID  │                    │                     │                 │                    │
   ├───────────────────►│                    │                     │                 │                    │
   │                    │ markPaymentAsPaid() │                     │                 │                    │
   │                    ├───────────────────►│                     │                 │                    │
   │                    │                    │ UPDATE Payment      │                 │                    │
   │                    │                    │ status:MARKED_AS_PAID                 │                    │
   │                    │                    │ markedPaidBy, UTR   │                 │                    │
   │                    │                    ├────────────────────────────────────────►                    │
   │                    │                    │                     │                 │                    │
   │                    │                    │ sendPaymentUpdateCard('MARKED_PAID')  │                    │
   │                    │                    ├────────────────────►│                 │                    │
   │                    │                    │                     │ INSERT Message  │                    │
   │                    │                    │                     │ (💸 card)       │                    │
   │                    │                    │                     ├────────────────►│                    │
   │                    │                    │                     │ redis.publish() │                    │
   │                    │                    │                     ├───────────────────────────────────────►
   │◄───────────────────┤                    │                     │                 │                    │

   ... (creditor sees 💸 card with [Confirm ✅] [Dispute ⚠️] buttons) ...

   │ CONFIRM_PAYMENT    │                    │                     │                 │                    │
   ├───────────────────►│                    │                     │                 │                    │
   │                    │ confirmPayment()   │                     │                 │                    │
   │                    ├───────────────────►│                     │                 │                    │
   │                    │                    │ BEGIN TRANSACTION   │                 │                    │
   │                    │                    │ UPDATE Payment → CONFIRMED            │                    │
   │                    │                    │ INSERT LedgerEntry (RECEIVABLE)       │                    │
   │                    │                    │ UPDATE Account.balance                │                    │
   │                    │                    │ INSERT mirror LedgerEntry             │                    │
   │                    │                    │ UPDATE mirror Account.balance         │                    │
   │                    │                    │ COMMIT                                │                    │
   │                    │                    ├────────────────────────────────────────►                    │
   │                    │                    │                     │                 │                    │
   │                    │                    │ sendPaymentUpdateCard('CONFIRMED')    │                    │
   │                    │                    ├────────────────────►│                 │                    │
   │                    │                    │                     │ INSERT ✅ card  │                    │
   │                    │                    │                     │ redis.publish() │                    │
   │                    │                    │                     ├───────────────────────────────────────►
   │◄───────────────────┤                    │                     │                 │                    │
   │ { payment,         │                    │                     │                 │                    │
   │   ledgerEntry }    │                    │                     │                 │                    │
```

### 5.2 Trip Lifecycle → Chat Cards

```
                   createTrip()              updateTripStatus()          createLoadCard()          createReceiveCard()
                       │                          │                          │                          │
                       ▼                          ▼                          ▼                          ▼
                  ┌─────────┐              ┌─────────────┐           ┌──────────────┐         ┌────────────────┐
  Thread gets:    │TRIP_CARD │              │SYSTEM_MESSAGE│           │SYSTEM_MESSAGE│         │SYSTEM_MESSAGE  │
  Card type:      │         │              │meta.type:    │           │meta.type:    │         │meta.type:      │
                  │ truck   │              │TRIP_STATUS_  │           │LOAD_CARD     │         │SHORTAGE_ALERT  │
                  │ driver  │              │UPDATE        │           │              │         │                │
                  │ route   │              │              │           │ rows[] table │         │ rows[] table   │
                  │ status  │              │ status badge │           │ Item|Qty|Rate│         │ Item|Loaded|   │
                  └─────────┘              └──────────────┘           └──────────────┘         │ Recv|Shortage  │
                                                                                               └────────────────┘

  Timeline in chat:
  ┌────────────────────────────────────────────────────────────────────────────────┐
  │  🚚 Trip Card: Mumbai → Pune, MH12AB1234                                      │
  │  🚚 Trip Status: LOADING                                                      │
  │  📦 Load Card — 3 items  [Item | Qty | Rate | Amount table]                   │
  │  🚚 Trip Status: IN_TRANSIT                                                   │
  │  🚚 Trip Status: DELIVERED                                                    │
  │  ⚠️ Shortage Alert: 50 KG short (10%)  [Item | Loaded | Recv | Short table]  │
  └────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Message Types & Metadata

### 6.1 Complete Metadata Schema per Type

#### TRIP_CARD
```json
{
  "messageType": "TRIP_CARD",
  "metadata": {
    "tripId": "clxxx...",
    "status": "ASSIGNED",
    "sourceOrg": "Mahajan Industries",
    "destinationOrg": "Vivek Transport",
    "truck": "MH12AB1234",
    "driverName": "Ramesh Kumar",
    "driverPhone": "+919876543210",
    "startPoint": "Mumbai",
    "endPoint": "Pune"
  }
}
```

#### PAYMENT_REQUEST (used for ALL payment states)
```json
{
  "messageType": "PAYMENT_REQUEST",
  "metadata": {
    "paymentId": "clxxx...",
    "amount": 50000,
    "status": "PENDING | MARKED_AS_PAID | CONFIRMED | DISPUTED",
    "action": "REQUESTED | MARKED_PAID | CONFIRMED | DISPUTED",
    "mode": "UPI",                 // null for REQUESTED
    "tag": "ADVANCE",              // null if not set
    "utrNumber": "UTR123456789",   // null for REQUESTED
    "remarks": "For freight",      // null if not set
    "disputeReason": "Not received" // only for DISPUTED
  }
}
```

#### INVOICE_CARD
```json
{
  "messageType": "INVOICE_CARD",
  "metadata": {
    "invoiceId": "clxxx...",
    "invoiceNumber": "INV-2026-001",
    "total": 100000,
    "description": "Freight charges Feb",
    "dueDate": "2026-03-15T00:00:00.000Z",
    "status": "OPEN"
  }
}
```

#### DATA_GRID
```json
{
  "messageType": "DATA_GRID",
  "metadata": {
    "title": "Ledger Timeline",
    "columns": ["Date", "Description", "Direction", "Amount", "Balance"],
    "rows": [
      { "Date": "13/02/2026", "Description": "Invoice #INV-001", "Direction": "PAYABLE", "Amount": "₹1,00,000", "Balance": "₹1,00,000" },
      { "Date": "14/02/2026", "Description": "Payment confirmed",  "Direction": "RECEIVABLE", "Amount": "₹50,000", "Balance": "₹50,000" }
    ]
  }
}
```

#### SYSTEM_MESSAGE with `metadata.type = LOAD_CARD`
```json
{
  "messageType": "SYSTEM_MESSAGE",
  "content": "📦 Load Card: 3 items loaded",
  "metadata": {
    "type": "LOAD_CARD",
    "tripId": "clxxx...",
    "title": "Load Card — 3 items",
    "columns": ["Item", "Qty", "Rate", "Amount"],
    "rows": [
      { "Item": "Tomatoes", "Qty": "500 KG", "Rate": "₹40", "Amount": "₹20,000" },
      { "Item": "Onions",   "Qty": "300 KG", "Rate": "₹30", "Amount": "₹9,000" }
    ],
    "itemCount": 3
  }
}
```

#### SYSTEM_MESSAGE with `metadata.type = SHORTAGE_ALERT`
```json
{
  "messageType": "SYSTEM_MESSAGE",
  "content": "⚠️ Shortage Alert: 50 units short (10%)",
  "metadata": {
    "type": "SHORTAGE_ALERT",
    "tripId": "clxxx...",
    "destinationOrg": "Vivek Transport",
    "totalShortage": 50,
    "shortagePercent": 10.00,
    "columns": ["Item", "Loaded", "Received", "Shortage", "Shortage %"],
    "rows": [
      { "Item": "Tomatoes", "Loaded": "500 KG", "Received": "450 KG", "Shortage": "50 KG", "Shortage %": "10%" }
    ]
  }
}
```

#### SYSTEM_MESSAGE with `metadata.type = TRIP_STATUS_UPDATE`
```json
{
  "messageType": "SYSTEM_MESSAGE",
  "content": "🚚 Trip status: IN_TRANSIT",
  "metadata": {
    "type": "TRIP_STATUS_UPDATE",
    "tripId": "clxxx...",
    "status": "IN_TRANSIT",
    "remarks": "Left from warehouse",
    "sourceOrg": "Mahajan Industries",
    "destinationOrg": "Vivek Transport",
    "truck": "MH12AB1234",
    "driver": "Ramesh Kumar"
  }
}
```

---

## 7. Real-Time (WebSocket) Flow

### 7.1 How Messages Are Pushed

```
Service creates message
        │
        ▼
  prisma.chatMessage.create(...)
        │
        ▼
  redisPublisher.publish(
    "thread:{threadId}:message",
    JSON.stringify(message)
  )
        │
        ▼
  Redis PubSub distributes to all server instances
        │
        ▼
  Socket.IO server receives → emits to room "thread:{threadId}"
        │
        ▼
  All connected clients in that room receive the message
        │
        ▼
  Frontend renders the appropriate card based on messageType
```

### 7.2 Client-Side Socket Events

```javascript
// Join a thread (call when opening a chat)
socket.emit('chat:join', { threadId: 'clxxx...' });

// Listen for new messages
socket.on('chat:message', (message) => {
  // message.messageType tells you what kind of card
  // message.metadata has the structured data
  renderCard(message);
});

// Leave thread
socket.emit('chat:leave', { threadId: 'clxxx...' });
```

---

## 8. Error Handling

### 8.1 Non-Blocking Pattern

Every service method that posts to chat follows this pattern:

```typescript
// 1. Do the REAL business logic first (inside transaction)
const payment = await prisma.$transaction(async (tx) => {
  // ... create/update payment ...
  return result;
});

// 2. Post to chat OUTSIDE the transaction (non-blocking)
try {
  await chatService.sendPaymentUpdateCard(accountId, payment, 'REQUESTED', userId);
} catch (error) {
  // Log but DO NOT throw — the payment was already created successfully
  logger.error('Failed to post payment card to chat', {
    paymentId: payment.id,
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}

return payment;  // Always return the result regardless of chat success
```

### 8.2 Why This Matters

| Scenario | What happens |
|---|---|
| Redis is down | Payment succeeds ✅, chat notification fails silently. User sees payment on refresh. |
| Thread doesn't exist | `sendAccountSystemMessage` auto-creates the thread. |
| User doesn't have chat access | Payment succeeds ✅. Chat post may fail, but financial record is safe. |

### 8.3 Error Codes from `performAction`

| Status | When |
|---|---|
| `400` | Missing `actionType` or unknown action |
| `400` | Payload validation fails (from Zod schemas in services) |
| `403` | User doesn't have permission (not org member) |
| `404` | Payment/Account/Trip not found |
| `409` | Conflict (e.g., load card already exists, duplicate invoice number) |
| `500` | Internal server error |

---

## 9. Security & Authorization

### 9.1 Auth Flow

```
Every request → authenticate middleware → JWT verified → req.user set
                                              │
                                              ▼
                                    performAction()
                                              │
                                         userId = req.user.id
                                              │
                               passed to every service method
                                              │
                        Service checks: "Is this user a member of the org?"
```

### 9.2 Who Can Do What

| Action | Who Can Execute |
|---|---|
| `CREATE_TRIP` | Members of `sourceOrg` |
| `REQUEST_PAYMENT` | Members of the org that owns the Account |
| `MARK_PAYMENT_PAID` | Members of the debtor org (the one who owes) |
| `CONFIRM_PAYMENT` | Members of the creditor org (the one who's owed) |
| `DISPUTE_PAYMENT` | Members of the creditor org |
| `CREATE_INVOICE` | Members of the org that owns the Account |
| `SHARE_DATA_GRID` | Anyone with thread access |
| `SHARE_LEDGER_TIMELINE` | Members of either org linked to the Account |

### 9.3 Thread Access Control

- Thread is linked to an `orgId`
- Only members of that org (checked via `OrgMember` table) can read/write to the thread
- Services create messages with `senderUserId: null` for system messages

---

## 10. Frontend Rendering Guide

### 10.1 Decision Tree

```javascript
function renderMessage(msg) {
  switch (msg.messageType) {
    case 'TEXT':           return <TextBubble />;
    case 'TRIP_CARD':      return <TripCard meta={msg.metadata} />;
    case 'PAYMENT_REQUEST': return <PaymentCard meta={msg.metadata} />;
    case 'INVOICE_CARD':   return <InvoiceCard meta={msg.metadata} />;
    case 'DATA_GRID':      return <DataTable meta={msg.metadata} />;
    case 'SYSTEM_MESSAGE':
      // Check sub-type
      switch (msg.metadata?.type) {
        case 'TRIP_STATUS_UPDATE': return <TripStatusBadge />;
        case 'LOAD_CARD':          return <DataTable />;
        case 'SHORTAGE_ALERT':     return <ShortageTable />;
        default:                   return <SystemText />;
      }
    case 'IMAGE':          return <ImagePreview />;
    case 'LOCATION':       return <MapPin />;
  }
}
```

### 10.2 Payment Card — Interactive Buttons by Status

```
┌────────────────────────────────────────────┐
│ Status in metadata   │ Buttons to show     │
├──────────────────────┼─────────────────────┤
│ action: "REQUESTED"  │ [Pay Now] (debtor)  │
│ action: "MARKED_PAID"│ [Confirm ✅]        │
│                      │ [Dispute ⚠️]        │
│                      │ (creditor only)     │
│ action: "CONFIRMED"  │ (no buttons, ✅)    │
│ action: "DISPUTED"   │ [Retry Payment]     │
│                      │ (debtor)            │
└──────────────────────┴─────────────────────┘
```

When user taps a button on a card, frontend calls:
```javascript
POST /chat/threads/{threadId}/action
{
  "actionType": "CONFIRM_PAYMENT",  // or MARK_PAYMENT_PAID, DISPUTE_PAYMENT
  "payload": {
    "paymentId": msg.metadata.paymentId  // taken from the card's metadata
  }
}
```

### 10.3 File Structure Recommendation (React Native)

```
components/
  chat/
    ChatScreen.tsx           // Main chat list
    MessageBubble.tsx        // Routes to correct card
    cards/
      TripCard.tsx           // 🚚 Trip info + [View Trip] button
      PaymentCard.tsx        // 💰 Amount + status + action buttons
      InvoiceCard.tsx        // 🧾 Invoice summary + [View] button
      DataGridCard.tsx       // 📊 Table with columns + rows
      ShortageAlertCard.tsx  // ⚠️ Red shortage table
      LoadCardSummary.tsx    // 📦 Items loaded table
      TripStatusBadge.tsx    // 🚚 Simple status badge
      SystemMessage.tsx      // Gray system text
    ActionMenu.tsx           // [+] button → bottom sheet with action options
    ActionForms/
      CreateTripForm.tsx
      RequestPaymentForm.tsx
      CreateInvoiceForm.tsx
      ShareDataForm.tsx
```

---

## Summary: What's Built vs What's Remaining

| Layer | Status |
|---|---|
| Database Schema (Prisma) | ✅ Done — all models, enums, relations |
| ChatService (new methods) | ✅ Done — sendAccountSystemMessage, sendPaymentUpdateCard, sendInvoiceCard |
| LedgerService → Chat integration | ✅ Done — all 5 payment/invoice methods post cards |
| TripService → Chat integration | ✅ Done — status updates, load cards, shortage alerts post structured data |
| ChatController.performAction | ✅ Done — 8 action types wired |
| API Routes | ✅ Done — `POST /threads/:id/action` |
| Test Page (HTML) | ✅ Done — `test-frontend/chat-test.html` |
| **Frontend (React Native) cards** | ❌ Pending — render cards based on messageType + metadata |
| **WebSocket client integration** | ❌ Pending — real-time card updates on frontend |
