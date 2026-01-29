# Mahajan-to-Mahajan Logistics Backend

A comprehensive logistics management system for vegetable transportation between Mahajans (collectors and distributors), featuring real-time tracking, ledger management, and transaction-aware chat.

## 🚀 Features

- **Trip Management**: Create and track trips between source (collector) and destination (distributor) Mahajans
- **Live GPS Tracking**: Real-time location updates via WebSocket with offline buffering
- **Load/Receive Cards**: Photo proof of quantity loaded vs received with automatic shortage calculation
- **Integrated Ledger**: Dual-account system for Org-to-Org transactions with payment timeline
- **Transaction-Aware Chat**: Chat threads linked to trips and ledger accounts with auto-messages for payments
- **GSTIN Support**: Optional GST badge display in chat headers
- **Driver Management**: Driver profiles with device binding and emergency contacts
- **File Storage**: S3 presigned URLs for direct uploads (photos, invoices, receipts)
- **Notifications**: BullMQ job queue for reliable async push notifications

## 📋 Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Real-time**: Socket.IO + Redis Pub/Sub
- **Cache & Queue**: Redis + BullMQ
- **Storage**: AWS S3 (MinIO for local dev)
- **Authentication**: JWT with bcrypt

## 🏗️ Project Structure

```
mahajan_app_backend/
├── prisma/
│   └── schema.prisma          # Database models
├── src/
│   ├── config/                # Configuration files
│   │   ├── env.ts
│   │   ├── database.ts
│   │   ├── redis.ts
│   │   ├── s3.ts
│   │   └── queue.ts
│   ├── middleware/            # Express middleware
│   │   ├── auth.middleware.ts
│   │   ├── rbac.middleware.ts
│   │   └── error.middleware.ts
│   ├── utils/                 # Utility functions
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   └── validators.ts
│   ├── auth/                  # Authentication module
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.routes.ts
│   │   └── auth.dto.ts
│   ├── org/                   # Organization module (TODO)
│   ├── drivers/               # Driver management (TODO)
│   ├── trucks/                # Truck management (TODO)
│   ├── trips/                 # Trip management (TODO)
│   ├── tracking/              # GPS tracking (TODO)
│   ├── ledger/                # Ledger & payments (TODO)
│   ├── chat/                  # Chat system (TODO)
│   ├── files/                 # File uploads (TODO)
│   ├── notifications/         # Push notifications (TODO)
│   ├── websocket/             # Socket.IO gateway (TODO)
│   ├── app.ts                 # Express app setup
│   └── index.ts               # Server entry point
├── docker-compose.yml         # Local development services
├── package.json
├── tsconfig.json
├── .env                       # Environment variables
└── .env.example               # Environment template
```

## 🚦 Getting Started

### Prerequisites

- Node.js 18+ and npm
- Docker Desktop (for PostgreSQL, Redis, MinIO)
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd mahajan_app_backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Docker services**
   ```bash
   docker-compose up -d
   # OR
   npm run docker:up
   ```

5. **Generate Prisma client**
   ```bash
   npm run prisma:generate
   ```

6. **Run database migrations**
   ```bash
   npm run prisma:migrate
   ```

7. **Start development server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3000`

### Docker Services

- **PostgreSQL**: `localhost:5432`
  - User: `mahajan`
  - Password: `mahajan123`
  - Database: `mahajan_logistics`

- **Redis**: `localhost:6379`

- **MinIO** (S3-compatible):
  - API: `localhost:9000`
  - Console: `localhost:9001`
  - Access Key: `minioadmin`
  - Secret Key: `minioadmin`

## 📡 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login user
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/logout` - Logout user

### Health Check
- `GET /health` - Server health status

*(More endpoints will be added as modules are implemented)*

## 🗄️ Database Schema

The Prisma schema includes the following main models:

- **User** - User accounts (Mahajan owners, staff, drivers)
- **Org** - Organizations (Mahajans)
- **OrgMember** - User-Organization membership with roles
- **DriverProfile** - Driver details and device binding
- **Truck** - Truck fleet management
- **Trip** - Trip lifecycle and status
- **TripLoadCard** - Load proof with photos
- **TripReceiveCard** - Receive proof with shortage calculation
- **TripEvent** - Trip timeline events
- **TripLocation** - GPS ping history
- **TripLatestLocation** - Cached latest position
- **Account** - Org-to-Org ledger accounts (dual records)
- **LedgerEntry** - Journal entries with running balance
- **Invoice** - Invoices with due dates
- **Payment** - Payment records with tags (ADVANCE, PARTIAL, FINAL, DUE)
- **ChatThread** - Chat threads (ledger or trip-based)
- **ChatMessage** - Messages with payment/invoice links
- **Attachment** - S3 file attachments
- **Dispute** - Shortage dispute management

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication:

1. **Register/Login** to receive access and refresh tokens
2. **Include token** in requests: `Authorization: Bearer <access_token>`
3. **Refresh token** when access token expires

Token expiration:
- Access Token: 15 minutes
- Refresh Token: 7 days

## 🛠️ Development Scripts

```bash
npm run dev              # Start development server with hot reload
npm run build            # Build TypeScript to JavaScript
npm run start            # Start production server
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run database migrations
npm run prisma:studio    # Open Prisma Studio (DB GUI)
npm run docker:up        # Start Docker services
npm run docker:down      # Stop Docker services
```

## 📝 Environment Variables

See `.env.example` for all required variables:

- **Database**: `DATABASE_URL`
- **Redis**: `REDIS_HOST`, `REDIS_PORT`
- **JWT**: `JWT_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION`
- **AWS S3**: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`
- **Server**: `PORT`, `NODE_ENV`
- **CORS**: `CORS_ORIGIN`

## 🚧 Roadmap

### Phase 1: Foundation (✅ Completed)
- [x] Project setup
- [x] Database schema
- [x] Authentication module
- [x] Express server with middleware

### Phase 2: Core Modules (In Progress)
- [ ] Organization management (CRUD, members)
- [ ] Driver and truck management
- [ ] File upload with S3 presigned URLs
- [ ] Trip management with load/receive cards

### Phase 3: Real-time Features
- [ ] GPS tracking service
- [ ] WebSocket gateway (Socket.IO)
- [ ] Redis pub/sub for location updates

### Phase 4: Ledger System
- [ ] Dual-account management
- [ ] Invoice and payment tracking
- [ ] Ledger timeline API

### Phase 5: Chat Integration
- [ ] Chat threads (ledger + trip)
- [ ] Transaction-aware messages
- [ ] Auto-messages for payments

### Phase 6: Polish & Deployment
- [ ] BullMQ notification worker
- [ ] Edge case handling
- [ ] API documentation (Swagger)
- [ ] Production deployment

## 📖 Documentation

For detailed architecture and implementation details, see:
- [Architecture Plan](./ARCHITECTURE_PLAN.md)

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Submit a pull request

## 📄 License

ISC

## 👥 Contact

For questions or support, please contact the development team.
