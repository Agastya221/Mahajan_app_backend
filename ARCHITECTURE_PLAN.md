# Mahajan-to-Mahajan Logistics MVP - Architecture Plan

## Executive Summary

A vegetables logistics platform connecting Source Mahajans (collectors) with Destination Mahajans (distributors) featuring:
- Real-time trip tracking with live GPS
- Load/Receive cards with photo proof
- Integrated ledger system with payment tracking
- Transaction-aware chat system
- Driver mobile app with background location

**Tech Stack:** Node.js, TypeScript, Express, PostgreSQL, Prisma, Redis, Socket.IO, AWS S3, BullMQ

---

## 1. System Architecture

### High-Level Components

```
Client Layer (Web + Mobile)
    ↓
API Gateway / Express Server
    ↓
Service Layer (Business Logic)
    ↓
Data Layer (PostgreSQL + Redis + S3)
```

### Key Subsystems

1. **Authentication & Authorization**
   - JWT-based authentication
   - Role-based access control (Org Owner, Admin, Member, Driver)
   - Device binding for driver security

2. **Organization Management**
   - Multi-org support
   - Org membership management
   - GSTIN integration (optional)

3. **Trip Management**
   - Trip lifecycle (Created → Loaded → In Transit → Delivered)
   - Event timeline tracking
   - Load and Receive cards with photo attachments
   - Automatic shortage calculation

4. **Live Tracking System**
   - GPS ping ingestion (every 5-10 seconds)
   - Redis Pub/Sub for real-time broadcast
   - WebSocket connections via Socket.IO
   - Historical location storage with retention

5. **Ledger System**
   - Dual-account approach (Account A→B and B→A)
   - Invoice management
   - Payment recording (ADVANCE, PARTIAL, FINAL, DUE)
   - Ledger entries with running balance
   - UPI-style timeline view

6. **Chat System**
   - Ledger-linked chat threads (Org to Org)
   - Trip-linked chat threads
   - Auto-messages for payments/invoices
   - File attachments support
   - GSTIN badge display

7. **File Storage**
   - S3 presigned URLs for direct upload
   - Support for photos (load cards, chat)
   - File status tracking (PENDING, COMPLETED, FAILED)

8. **Notification System**
   - BullMQ job queues
   - Push notifications (Firebase/SNS)
   - Event-driven notifications (trip created, payment received, etc.)

---

## 2. Module Structure

```
src/
├── config/          # Database, Redis, S3, Queue setup
├── middleware/      # Auth, RBAC, Error handling, File upload
├── auth/            # Login, Register, JWT management
├── org/             # Organization CRUD, Member management
├── drivers/         # Driver CRUD, Device binding
├── trucks/          # Truck CRUD
├── trips/           # Trip management, Events, Load/Receive cards
├── tracking/        # Location ping handling, History
├── ledger/          # Accounts, Invoices, Payments, Entries
├── chat/            # Threads, Messages, Integration
├── files/           # S3 presigned URLs, Upload confirmation
├── notifications/   # BullMQ queue, Push notification workers
├── websocket/       # Socket.IO gateway, Event handlers
└── utils/           # Logger, Validators, Error classes
```

---

## 3. Database Design

### Core Entities

**User Management:**
- User (phone, email, password, role)
- Organization (name, GSTIN, phone, address)
- OrgMember (user-org relationship with role)

**Fleet Management:**
- Driver (org-linked, phone, license, deviceId)
- Truck (org-linked, registration, capacity)

**Trip Management:**
- Trip (source/destination orgs, truck, driver, route, status)
- TripEvent (timeline of status changes)
- LoadCard (quantity, unit, photos, timestamp)
- ReceiveCard (quantity, unit, photos, shortage, timestamp)

**Tracking:**
- TripLocation (historical GPS pings with timestamp)
- TripLatestLocation (cached latest position for fast reads)

**Ledger:**
- Account (ownerOrg, counterpartyOrg, balance) - Dual records
- Invoice (accountId, amount, status, dueDate)
- Payment (accountId, amount, type, method, transactionId)
- LedgerEntry (account, type, amount, running balance, references)

**Chat:**
- ChatThread (type: LEDGER_CHAT or TRIP_CHAT, linked to account/trip)
- ChatMessage (content, sender, type, linkedPayment/Invoice, attachments)

**Files:**
- File (filename, s3Key, s3Url, uploadedBy, status)

### Key Relationships

- Organization → many Drivers, Trucks, Trips (as source/destination)
- Trip → one LoadCard, one ReceiveCard, many Locations, one ChatThread
- Account → many Invoices, Payments, LedgerEntries, one ChatThread
- Payment/Invoice → many ChatMessages (auto-generated)

---

## 4. API Design

### REST Endpoints

**Auth:**
- POST /auth/register
- POST /auth/login
- POST /auth/refresh
- POST /auth/logout

**Organizations:**
- POST /orgs (create)
- GET /orgs/:id (details)
- PATCH /orgs/:id (update)
- POST /orgs/:id/members (add member)
- DELETE /orgs/:id/members/:memberId

**Drivers & Trucks:**
- CRUD endpoints for both
- Filtered by orgId

**Trips:**
- POST /trips (create)
- GET /trips (list with filters)
- GET /trips/:id (detail with events, cards, latest location)
- PATCH /trips/:id/status
- POST /trips/:id/load-card
- POST /trips/:id/receive-card
- GET /trips/:id/locations (history)

**Tracking:**
- POST /tracking/ping (batched location pings from driver)

**Ledger:**
- GET /ledger/accounts (list for org)
- GET /ledger/accounts/:id (details)
- GET /ledger/accounts/:id/timeline (UPI-style view)
- POST /ledger/invoices
- PATCH /ledger/invoices/:id
- POST /ledger/payments (creates payment + ledger entry + chat message)
- GET /ledger/entries (filtered by account)

**Chat:**
- POST /chat/threads (create)
- GET /chat/threads/:id/messages
- POST /chat/threads/:id/messages
- GET /chat/threads (filter by account/trip)

**Files:**
- POST /files/presigned-url (request upload URL)
- POST /files/confirm-upload (mark as completed)
- GET /files/:id/download-url (presigned download)

### WebSocket Events

**Client → Server:**
- tracking:subscribe (join trip room)
- tracking:unsubscribe
- org:join (join org room)
- chat:join (join chat room)

**Server → Client:**
- tracking:location-update (GPS data)
- trip:status-changed
- chat:message (new message)
- ledger:payment-received
- trip:load-card-created
- trip:receive-card-created

---

## 5. Real-Time Architecture

### Location Tracking Flow

1. Driver app sends batched GPS pings (5-10 sec intervals) to POST /tracking/ping
2. Backend validates trip + driver authorization
3. Store pings in TripLocation (history table)
4. Update TripLatestLocation (single row cache per trip)
5. Publish to Redis channel: `trip:{tripId}:location`
6. Socket.IO gateway subscribes to `trip:*:location` pattern
7. Broadcast to all WebSocket clients in room `trip:{tripId}`

### WebSocket Room Strategy

- `org:{orgId}` - All org members
- `trip:{tripId}` - All trip participants
- `chat:{threadId}` - Chat subscribers
- `account:{accountId}` - Ledger participants

### Redis Usage

- **Pub/Sub:** Real-time location broadcasts
- **Cache:** Latest trip locations (TripLatestLocation could also cache here)
- **Queue Backend:** BullMQ for notifications

---

## 6. Key Features Implementation

### Load/Receive Cards with Shortage

1. Source Mahajan creates LoadCard: quantity, unit, photos (S3), timestamp
2. Destination Mahajan creates ReceiveCard: quantity, unit, photos
3. Backend auto-calculates: `shortage = loaded_quantity - received_quantity`
4. If shortage exists, support dispute flow (optional: DisputeNote model)

### Dual-Account Ledger System

**Strategy:** When Org A trades with Org B, create TWO Account records:
- Account1: ownerOrgId=A, counterpartyOrgId=B, balance=+1000
- Account2: ownerOrgId=B, counterpartyOrgId=A, balance=-1000

**Payment Flow:**
1. User creates payment via API
2. Backend updates BOTH accounts in transaction
3. Create LedgerEntry with running balance
4. Auto-create ChatMessage in ledger chat thread
5. Broadcast payment event via WebSocket

### Transaction-Aware Chat

- Each Account gets one ChatThread (type: LEDGER_CHAT)
- Each Trip gets one ChatThread (type: TRIP_CHAT)
- When payment/invoice created, auto-generate ChatMessage with reference
- Messages display as timeline (text, payment notification, invoice, etc.)
- Chat header shows GSTIN badge, "Call Driver" button, location sharing

### File Upload with Presigned URLs

1. Client requests presigned URL with file metadata
2. Backend generates S3 presigned PUT URL (valid 15 min)
3. Backend creates File record with status=PENDING
4. Client uploads directly to S3
5. Client confirms upload, backend marks File as COMPLETED
6. Use fileId in LoadCard.photoUrls[], ChatMessage.attachmentUrls[]

---

## 7. Edge Cases & Solutions

### Offline Driver Handling

- **Problem:** Driver loses internet, GPS pings buffer on device
- **Solution:**
  - Client buffers pings with timestamps
  - On reconnect, send batched pings (max 500 at once)
  - Backend accepts historical pings with timestamp validation
  - Use `batchId` (UUID) for idempotency check

### Duplicate Ping Prevention

- Each batch has unique `batchId`
- Before insert, check if batchId exists in TripLocation
- Skip insert if duplicate found

### Shortage Disputes

- ReceiveCard has `shortage` field (auto-calculated)
- Add `disputeStatus` enum: NONE, RAISED, UNDER_REVIEW, RESOLVED
- Optional: DisputeNote model for discussion
- Use trip chat thread for dispute resolution

### Two-Way Account Sync

- Always update BOTH accounts in transaction
- Mirror account balance = -original_balance
- Ensures consistency across org perspectives

### GSTIN Optional

- Organization.gstin is nullable
- UI shows badge only if present
- Include copy-to-clipboard functionality

---

## 8. Implementation Roadmap (6 Weeks)

### Week 1: Foundation
- Initialize Node.js + TypeScript project
- Set up Express server with middleware
- Configure Prisma + PostgreSQL
- Docker Compose for local dev (Postgres, Redis, MinIO)
- Build Auth module (register, login, JWT)
- Build Organization module (CRUD, members)

### Week 2: Core Entities
- Drivers module (CRUD, device binding)
- Trucks module (CRUD)
- Files module (S3 client, presigned URLs)
- Trip module (create, update, events)
- Load/Receive cards with photo upload

### Week 3: Real-Time Features
- Tracking module (ping endpoint, storage)
- Redis Pub/Sub setup
- Socket.IO gateway with authentication
- WebSocket room management
- Location broadcast handler

### Week 4: Ledger System
- Account management (dual-account creation)
- Invoice CRUD
- Payment creation with dual-account sync
- LedgerEntry generation
- Timeline API

### Week 5: Chat Integration
- ChatThread and ChatMessage models
- Create threads (ledger + trip)
- Send/receive messages
- Auto-message for payments
- WebSocket chat broadcast
- Chat enhancements (GSTIN, call driver, share location)

### Week 6: Notifications & Polish
- BullMQ queue setup
- Notification worker
- Firebase Cloud Messaging integration (optional)
- Edge case handling (idempotency, offline, disputes)
- API documentation (Swagger/Postman)
- Integration tests
- Load testing for tracking endpoints

---

## 9. Technology Setup

### Dependencies

**Core:**
- express, typescript, @types/node, @types/express
- prisma, @prisma/client
- socket.io
- ioredis, bullmq
- jsonwebtoken, bcryptjs
- zod (validation), dotenv, cors, helmet, express-rate-limit

**AWS:**
- @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
- multer (for multipart handling)

**Dev:**
- ts-node, nodemon
- @types/cors, @types/helmet

### Infrastructure (Docker Compose)

- PostgreSQL 15
- Redis 7
- MinIO (S3-compatible for local dev)

### Production Deployment (AWS)

- **Compute:** ECS Fargate (Docker containers)
- **Database:** RDS PostgreSQL
- **Cache:** ElastiCache Redis
- **Storage:** S3
- **Load Balancer:** Application Load Balancer

---

## 10. React Native Driver App Considerations

### Background Location Tracking

**Library:** `react-native-background-geolocation` or `@mauron85/react-native-background-geolocation`

**Configuration:**
- Desired accuracy: HIGH_ACCURACY
- Distance filter: 50m
- Interval: 10 seconds (configurable)
- Start on boot: true
- Stop on terminate: false

### Ping Batching Strategy

- Collect pings every 5-10 seconds
- Batch send every 30 seconds OR when batch reaches 10 pings
- On reconnect after offline, flush entire buffer
- Use AsyncStorage for offline persistence
- Generate unique batchId per batch (UUID)

### Driver App Features

1. **Login:** Phone + password
2. **Active Trip View:**
   - Current trip details
   - Start/stop tracking button
   - Upload load photos
3. **Location Sharing:**
   - Automatic background tracking
   - Manual location refresh
4. **Trip History:** Past trips with details

---

## 11. Testing Strategy

### Manual Testing Checklist

1. **Auth Flow:** Register → Login → Protected routes
2. **Trip Creation:** Org → Driver → Truck → Trip
3. **Location Tracking:** Send pings → WebSocket broadcast
4. **Load/Receive:** Upload photos → Calculate shortage
5. **Ledger:** Create payment → Update accounts → Auto chat message
6. **Chat:** Send message → WebSocket delivery

### Automated Tests

- Unit tests for services (Jest)
- Integration tests for API endpoints (Supertest)
- WebSocket event tests (Socket.IO client)

### Load Testing

- Simulate 100+ drivers sending pings simultaneously
- Target: <500ms response time for /tracking/ping
- Tool: Artillery or k6

---

## 12. Security Considerations

### Authentication
- JWT with short expiration (15 min access, 7 day refresh)
- Secure password hashing (bcrypt, 10 rounds)
- Device binding for drivers (optional)

### Authorization
- Role-based middleware (org owner, admin, member)
- Verify user belongs to org before trip/ledger operations
- Driver can only update their own trips

### Data Protection
- Helmet.js for security headers
- Rate limiting on auth endpoints
- Input validation with Zod
- Prepared statements via Prisma (SQL injection prevention)
- CORS configuration

### File Upload
- File size limits (10MB for MVP)
- Mime type validation
- Presigned URL expiration (15 min upload, 1 hour download)
- S3 bucket policies (private by default)

---

## 13. Monitoring & Observability

### Logging
- Winston or Pino for structured logging
- Log levels: error, warn, info, debug
- Request/response logging
- Error tracking with stack traces

### Metrics (Future)
- API response times
- WebSocket connection count
- Redis pub/sub latency
- Database query performance
- File upload success rate

### Alerts (Future)
- Failed payment syncs
- High location ping latency
- Database connection errors
- S3 upload failures

---

## 14. Data Retention & Cleanup

### Location Data
- Keep full TripLocation history for completed trips (configurable: 90 days)
- Archive old data to S3 (Parquet format)
- TripLatestLocation: delete when trip completed + 7 days

### Chat Messages
- Retain indefinitely (business requirement)
- Option to export chat history

### Files
- Retain photos for completed trips: 1 year
- Move to S3 Glacier after 6 months

---

## 15. Future Enhancements (Post-MVP)

### Analytics Dashboard
- Trip completion rates
- Average delivery time
- Shortage patterns
- Payment trends

### Advanced Features
- Route optimization suggestions
- ETA prediction with ML
- Automated invoice generation from trips
- Multi-currency support
- Driver performance scoring
- Geofencing for automatic status updates

### Integrations
- WhatsApp notifications
- SMS alerts
- Accounting software export (Tally, QuickBooks)
- Google Maps integration

---

## Summary

This architecture provides a solid foundation for the Mahajan-to-Mahajan logistics MVP:

✅ **Real-time tracking** via Redis Pub/Sub + Socket.IO
✅ **Scalable file uploads** with S3 presigned URLs
✅ **Dual-account ledger** for two-way visibility
✅ **Transaction-aware chat** with auto-messages
✅ **Offline-resilient** driver app with batching
✅ **Job queues** for reliable notifications
✅ **Modular architecture** for easy maintenance

**Next Step:** Begin implementation with project initialization and Prisma schema definition.
