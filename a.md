You are a senior full-stack architect. Help me design and implement an MVP for a “Mahajan-to-Mahajan” vegetables logistics + dues + chat app.

Context (real world):
- Every party is a Mahajan (business). There are two roles per trip:
  1) Source Mahajan (Collector / Mandi Mahajan) who collects from farmers and sends goods
  2) Destination Mahajan (City Mahajan / Distributor) who receives the truck and sells to small vendors
- One Mahajan can manage many trucks and drivers.
- Biggest problems to solve:
  A) Load/Quantity proof missing → disputes about “kitna bheja vs kitna aaya”
  B) Chat exists but not transaction-aware → no payment timeline, invoices/receipts, ledger sheets
  C) Driver details hard to find → must be accessible in 1 click
  D) GSTIN should show under Mahajan name in chat (optional + copy)

MVP Features:
1) Trip management:
- Create Trip: sourceMahajanOrgId, destinationMahajanOrgId, truck, driver, route (start/end), eta, status
- Status timeline (events)
- Live location tracking (driver app sends pings same with better ui tracking system cause we need to build it or maybe suggest me better tech stack for building this live tracking system ; dashboard subscribes live)

2) Load Card + Receive Card:
- Per Trip: quantity + unit (kg/bag/ton/etc), timestamp, photo attachments
- Auto shortage calculation = loaded - received(we can build it since we dont have any scaling system so it not possible)

3) Ledger (Org↔Org):
- Account between two mahajans (ownerOrgId, counterpartyOrgId)
- Invoices + Payments + Ledger entries =  like we need to track all the deatils of the whole system not just payments 
- Payment tags: ADVANCE / PARTIAL / FINAL / DUE / cash paid then put the amount you get cash in 
- Must support “UPI-style timeline” view (but in  click we can make it like excel sheet of every maal(like payments details, wuantiy who which mahajan sended it, how much payment we need to give or other mahajan have to pay ) 

4) Chat with Ledger:
- ChatThread linked to Account (ledger chat) and optionally to a Trip (trip chat)
- ChatMessage can link to Payment/Invoice/LedgerEntry and include attachments
- Chat header shows GSTIN badge (copy), and buttons like “Call Driver” + “Open Trip” + “Share Location”

Tech preferences:
- Backend: Node.js + TypeScript
- ORM: Prisma
- DB: PostgreSQL
- Redis: for pub/sub and caching latest locations
- Realtime: WebSockets (Socket.IO preferred)
- Queue: BullMQ for async tasks (optional in MVP)
- Storage: S3 (or compatible) for attachments/photos

Architecture I want (describe + suggest best practice):
- Monolith for MVP, but clean modules:
  auth/
  org/
  drivers/
  trucks/
  trips/
  tracking/
  ledger/
  chat/
  files/
  notifications/
- APIs: REST for CRUD + WebSocket for live tracking + chat updates
- Location ingestion: driver sends batched points every 5–10 sec; store TripLatestLocation for fast reads; store TripLocation history with retention
- Security: role-based access (org members), device binding for drivers (optional)

What I need from you:
1) A clear system architecture diagram explained in text (components, data flow).
2) The exact module breakdown (folders, services, controllers, DTOs).
3) API contract list (endpoints + request/response shapes) for:
   - Auth
   - Orgs + membership
   - Drivers + trucks
   - Trips + events
   - Load/Receive cards + attachments
   - Ledger (accounts, invoices, payments, timeline)
   - Chat (threads, messages)
   - Tracking (ping endpoint + websocket events)
4) WebSocket event design:
   - channels/rooms naming
   - events for location updates and chat messages
5) DB design guidance:
   - explain key Prisma models and relations for Org↔Org trips and ledger
6) MVP build order (step-by-step) with minimal screens:
   - Mahajan dashboard
   - Trip detail map + load/receive cards
   - Ledger view (timeline)
   - Chat with ledger
   - Driver app minimal flow (login + share location(it will be a react native app so even in backgorund it should work and give updates ))
7) Provide code skeletons (TypeScript) for:
   - Prisma models summary
   - Trip creation
   - Location ping handler
   - Socket.IO gateway
   - Creating Payment + auto message in chat timeline
8) Include edge cases:
   - offline driver buffering
   - duplicate pings (idempotency)
   - disputes and shortage scenario
   - GSTIN optional
   - two-way ledger visibility (A->B and B->A account rows strategy)

Keep it practical and MVP-focused. Assume I will host on AWS with Docker.
