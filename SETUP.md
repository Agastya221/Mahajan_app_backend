# Quick Setup Guide

## What's Been Built

✅ **Project Infrastructure**
- Node.js + TypeScript project initialized
- All dependencies installed
- Docker Compose configured (PostgreSQL, Redis, MinIO)
- Prisma schema with complete database models
- Environment variables configured

✅ **Core Configuration**
- Database connection (Prisma)
- Redis pub/sub clients
- S3 client (AWS SDK)
- BullMQ queue setup
- Environment validation

✅ **Middleware & Utilities**
- Error handling middleware
- JWT authentication middleware
- RBAC (Role-Based Access Control)
- Logger utility
- Custom error classes
- Zod validation schemas

✅ **Auth Module** (Complete)
- User registration
- User login
- JWT token generation
- Token refresh
- Password hashing with bcrypt
- RESTful API endpoints

✅ **Express Server**
- App setup with security middleware (Helmet, CORS)
- Rate limiting
- Request logging
- Health check endpoint
- Graceful shutdown handling

## Next Steps to Run the Server

### 1. Start Docker Services

**Important:** Start Docker Desktop first, then run:

```bash
npm run docker:up
```

This will start:
- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- MinIO on `localhost:9000` (API) and `localhost:9001` (Console)

### 2. Generate Prisma Client

```bash
npm run prisma:generate
```

### 3. Run Database Migrations

```bash
npm run prisma:migrate
```

When prompted for a migration name, use: `init`

### 4. Start Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3000`

## Testing the API

### Health Check
```bash
curl http://localhost:3000/health
```

### Register a User
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919876543210",
    "password": "password123",
    "name": "Test User",
    "role": "MAHAJAN_OWNER"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919876543210",
    "password": "password123"
  }'
```

## What's Left to Build

### Immediate Next Steps:
1. **Organization Module** - Create/manage organizations, add members
2. **Driver & Truck Modules** - Manage fleet
3. **File Upload Module** - S3 presigned URL generation
4. **Trip Module** - Create trips, load/receive cards

### After Core Modules:
5. **Tracking Service** - GPS ping handling
6. **WebSocket Gateway** - Real-time location updates
7. **Ledger Module** - Dual-account system, payments, invoices
8. **Chat Module** - Transaction-aware messaging
9. **Notification Worker** - BullMQ job processor

## Project Status

**Completion: ~30%**

- ✅ Foundation & Infrastructure (100%)
- ✅ Auth Module (100%)
- ⏳ Organization Module (0%)
- ⏳ Core Business Modules (0%)
- ⏳ Real-time Features (0%)
- ⏳ Ledger & Chat (0%)

## Troubleshooting

### Docker Connection Issues
- Make sure Docker Desktop is running
- Check Docker services: `docker-compose ps`
- View logs: `docker-compose logs`

### Prisma Issues
- If migration fails, check DATABASE_URL in .env
- Reset database: `npx prisma migrate reset`

### Redis Connection Errors
- Verify Redis is running: `docker-compose ps redis`
- Test connection: `redis-cli ping` (should return PONG)

### Port Already in Use
- Change PORT in .env file
- Or kill process using the port: `npx kill-port 3000`

## Database Access

### Prisma Studio (GUI)
```bash
npm run prisma:studio
```
Opens at `http://localhost:5555`

### PostgreSQL CLI
```bash
docker exec -it mahajan_postgres psql -U mahajan -d mahajan_logistics
```

### MinIO Console
Open `http://localhost:9001` in browser
- Username: `minioadmin`
- Password: `minioadmin`

## VS Code Extensions (Recommended)

- Prisma
- ESLint
- Prettier
- REST Client (for testing APIs)
- Docker

## Need Help?

Check the main [README.md](./README.md) or [ARCHITECTURE_PLAN.md](./ARCHITECTURE_PLAN.md) for detailed documentation.
