# Performance Optimization Guide

## Overview
This document outlines performance optimizations for production deployment, focusing on database queries, caching strategies, and system architecture improvements.

---

## 🔴 Critical Performance Issues

### 1. **Missing Database Indexes**

**Impact:** Queries will slow down exponentially as data grows. Without indexes, queries perform full table scans.

**Current State:** No custom indexes defined in schema.

**Solution:**
```prisma
// prisma/schema.prisma

model Trip {
  // ... existing fields ...

  // Composite indexes for common queries
  @@index([sourceMahajanId, status, createdAt(sort: Desc)])
  @@index([destinationMahajanId, status, createdAt(sort: Desc)])
  @@index([driverId, status])
  @@index([truckId, status])
  @@index([status, createdAt(sort: Desc)])  // For global trip listing
}

model TripLocation {
  // ... existing fields ...

  @@index([tripId, timestamp(sort: Desc)])  // For location history
  @@index([batchId])  // For duplicate detection
  @@index([tripId, createdAt(sort: Desc)])
}

model TripEvent {
  // ... existing fields ...

  @@index([tripId, timestamp(sort: Desc)])
}

model Account {
  // ... existing fields ...

  @@index([ownerOrgId, createdAt(sort: Desc)])
  @@index([counterpartyOrgId])
}

model LedgerEntry {
  // ... existing fields ...

  @@index([accountId, createdAt(sort: Desc)])
  @@index([invoiceId])
  @@index([paymentId])
}

model ChatMessage {
  // ... existing fields ...

  @@index([threadId, createdAt(sort: Desc)])
  @@index([senderId, createdAt(sort: Desc)])
}

model ChatThread {
  // ... existing fields ...

  @@index([accountId])
  @@index([tripId])
  @@index([updatedAt(sort: Desc)])  // For recent chats listing
}

model OrgMember {
  // ... existing fields ...

  @@index([userId, role])  // For finding user's orgs with role
}

model Attachment {
  // ... existing fields ...

  @@index([uploadedByUserId, createdAt(sort: Desc)])
  @@index([loadCardId])
  @@index([receiveCardId])
  @@index([invoiceId])
  @@index([paymentId])
  @@index([chatMessageId])
}

model DriverProfile {
  // ... existing fields ...

  @@index([orgId])
  @@index([deviceId])  // For driver app login
}

model Truck {
  // ... existing fields ...

  @@index([orgId])
}
```

**After adding indexes:**
```bash
npx prisma migrate dev --name add_performance_indexes
```

**Estimated Impact:**
- Query performance improvement: **10-1000x** depending on data volume
- Typical query time reduction: From seconds to milliseconds

---

### 2. **Implement Caching Strategy**

#### A. Redis Caching for Frequently Accessed Data

**What to Cache:**
1. Organization details (changes rarely)
2. User profiles (changes rarely)
3. Trip details (during active tracking)
4. Latest location (already partially done)

**Implementation:**

```typescript
// src/cache/redis-cache.service.ts
import { redisClient } from '../config/redis';

export class RedisCacheService {
  private defaultTTL = 300; // 5 minutes

  async get<T>(key: string): Promise<T | null> {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  }

  async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    await redisClient.setex(key, ttl, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await redisClient.del(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  }

  // Cache keys generator
  keys = {
    org: (orgId: string) => `org:${orgId}`,
    user: (userId: string) => `user:${userId}`,
    trip: (tripId: string) => `trip:${tripId}`,
    orgMembers: (orgId: string) => `org:${orgId}:members`,
    userOrgs: (userId: string) => `user:${userId}:orgs`,
  };
}

export const cacheService = new RedisCacheService();
```

**Update OrgService with caching:**
```typescript
// src/org/org.service.ts
import { cacheService } from '../cache/redis-cache.service';

async getOrgById(orgId: string, userId?: string) {
  // Try cache first
  const cached = await cacheService.get(cacheService.keys.org(orgId));
  if (cached) {
    return cached;
  }

  // Cache miss - fetch from DB
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    include: {
      members: { /* ... */ },
      trucks: { /* ... */ },
      drivers: { /* ... */ },
    },
  });

  if (!org) {
    throw new NotFoundError('Organization not found');
  }

  // Cache for 10 minutes
  await cacheService.set(cacheService.keys.org(orgId), org, 600);

  return org;
}

async updateOrg(orgId: string, data: UpdateOrgDto, userId: string) {
  // ... validation ...

  const updated = await prisma.org.update({
    where: { id: orgId },
    data,
  });

  // ✅ Invalidate cache on update
  await cacheService.delete(cacheService.keys.org(orgId));

  return updated;
}
```

**Estimated Impact:**
- Cache hit response time: **<5ms** vs. **50-100ms** DB query
- Database load reduction: **60-80%**
- Cost savings: Fewer DB connections needed

---

### 3. **Optimize N+1 Queries**

#### Problem Locations:

**A. Trip List with Nested Relations**
```typescript
// ❌ BAD: Loads full relations unnecessarily
const trips = await prisma.trip.findMany({
  where,
  include: {
    sourceMahajan: true,  // Loads ALL fields
    destinationMahajan: true,
    truck: true,
    driver: {
      include: {
        user: true,  // Loads ALL user fields
      },
    },
  },
});
```

**✅ GOOD: Use select for specific fields**
```typescript
const trips = await prisma.trip.findMany({
  where,
  select: {
    id: true,
    status: true,
    startPoint: true,
    endPoint: true,
    createdAt: true,
    estimatedArrival: true,
    sourceMahajan: {
      select: {
        id: true,
        name: true,
        city: true,
      },
    },
    destinationMahajan: {
      select: {
        id: true,
        name: true,
        city: true,
      },
    },
    truck: {
      select: {
        id: true,
        number: true,
        type: true,
      },
    },
    driver: {
      select: {
        id: true,
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    },
    latestLocation: {
      select: {
        latitude: true,
        longitude: true,
        timestamp: true,
      },
    },
  },
  orderBy: { createdAt: 'desc' },
});
```

**Estimated Impact:**
- Data transferred: **70% reduction**
- Query time: **30-50% faster**

---

### 4. **Implement Connection Pooling**

**Current:** Default Prisma connection pool (unlimited).

**Problem:** Can exhaust database connections under load.

**Solution:**
```typescript
// src/config/database.ts
import { PrismaClient } from '@prisma/client';
import { config } from './env';

const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: config.database.url,
    },
  },
  // ✅ Add connection pooling
  // @ts-ignore - not in types yet
  connectionLimit: 20,  // Max 20 connections
});

// Connection pool timeout
prisma.$connect().catch(err => {
  console.error('Failed to connect to database:', err);
  process.exit(1);
});

export default prisma;
```

**Better: Use PgBouncer** (for production)
```bash
# docker-compose.yml
pgbouncer:
  image: edoburu/pgbouncer
  environment:
    DATABASE_URL: postgres://user:pass@postgres:5432/mahajan_db
    POOL_MODE: transaction
    MAX_CLIENT_CONN: 1000
    DEFAULT_POOL_SIZE: 20
  ports:
    - "6432:5432"
```

**Update connection string:**
```env
DATABASE_URL=postgresql://user:pass@pgbouncer:6432/mahajan_db?pgbouncer=true
```

---

### 5. **Batch Operations for Tracking**

**Current:** Individual inserts for each location.

**Problem:** `createMany()` is used, but can be optimized further with batching.

**Optimization:**
```typescript
// src/tracking/tracking.service.ts
async storePings(
  tripId: string,
  driverId: string,
  locations: LocationPingDto[]
) {
  // ... validation ...

  // ✅ Batch insert in chunks of 500
  const BATCH_SIZE = 500;

  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);

    await prisma.tripLocation.createMany({
      data: batch.map(loc => ({
        tripId,
        driverId,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        speed: loc.speed,
        timestamp: new Date(loc.timestamp),
        batchId: loc.batchId,
      })),
      skipDuplicates: true,  // ✅ Skip if duplicate batchId
    });
  }

  // ... rest of logic ...
}
```

---

### 6. **Implement Read Replicas (Production)**

**Architecture:**
```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Load Balancer  │
└────────┬────────┘
         │
    ┌────┴─────┐
    ▼          ▼
┌────────┐  ┌────────┐
│ Node 1 │  │ Node 2 │
└────┬───┘  └───┬────┘
     │          │
     ▼          ▼
┌──────────────────┐      ┌──────────────────┐
│  Primary DB      │─────▶│  Read Replica 1  │
│  (writes only)   │      │  (reads only)    │
└──────────────────┘      └──────────────────┘
                            │
                            ▼
                          ┌──────────────────┐
                          │  Read Replica 2  │
                          │  (reads only)    │
                          └──────────────────┘
```

**Implementation:**
```typescript
// src/config/database.ts
import { PrismaClient } from '@prisma/client';

// Primary (for writes)
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL, // Primary DB
    },
  },
});

// Read replica (for reads)
export const prismaRead = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_READ_URL, // Read replica
    },
  },
});
```

**Usage:**
```typescript
// For reads - use replica
const trips = await prismaRead.trip.findMany({...});

// For writes - use primary
await prisma.trip.create({...});
```

**Estimated Impact:**
- Read query latency: **30-50% reduction**
- Primary DB load: **70-80% reduction**
- Write availability: **Higher** (primary not overloaded)

---

## 🟡 Important Optimizations

### 7. **Implement GraphQL DataLoader Pattern**

**Problem:** In REST, fetching related data requires multiple requests.

**Consider:** Moving to GraphQL with DataLoader for batching.

**Alternative REST Solution: Field Selection**
```typescript
// Allow clients to specify fields
GET /api/v1/trips?fields=id,status,sourceMahajan.name,truck.number

// Implementation
async getTrips(filters: any, fields?: string[]) {
  const select = this.parseFieldSelection(fields);

  return prisma.trip.findMany({
    where: filters,
    select,
  });
}
```

---

### 8. **Optimize WebSocket Broadcasts**

**Current:** Broadcasts to all sockets in room.

**Problem:** Serializes data for each socket.

**Optimization:**
```typescript
// src/websocket/socket.gateway.ts
broadcastToTrip(tripId: string, event: string, data: any) {
  const room = `trip:${tripId}`;

  // ✅ Serialize once, send to all
  const serialized = JSON.stringify(data);

  this.io.to(room).emit(event, serialized);
}
```

---

### 9. **Implement Response Compression**

**Add to app.ts:**
```typescript
import compression from 'compression';

export function createApp(): Application {
  const app = express();

  // ✅ Add compression (before other middleware)
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6,  // Compression level (0-9)
  }));

  // ... rest of middleware
}
```

**Estimated Impact:**
- Response size: **60-80% reduction** for JSON
- Bandwidth savings: **Significant** for large responses
- CPU cost: **Minimal** (worth it)

---

### 10. **Add HTTP Caching Headers**

```typescript
// For static/rarely-changing data
app.get('/api/v1/orgs/:orgId', authenticate, (req, res) => {
  // ✅ Set cache headers
  res.set('Cache-Control', 'private, max-age=300');  // 5 minutes
  res.set('ETag', generateETag(org));

  res.json({ success: true, data: org });
});

// For frequently-changing data
app.get('/api/v1/tracking/trips/:tripId/latest', authenticate, (req, res) => {
  // ✅ No cache for real-time data
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');

  res.json({ success: true, data: location });
});
```

---

## 🟢 Nice-to-Have Optimizations

### 11. **Implement Lazy Loading for Large Lists**

**Example: Chat messages**
```typescript
// Load first 50 messages, then load more on scroll
GET /api/v1/chat/threads/:threadId/messages?limit=50&offset=0

// Next page
GET /api/v1/chat/threads/:threadId/messages?limit=50&offset=50
```

---

### 12. **Use Materialized Views for Reports**

**For dashboards/analytics:**
```sql
-- Create materialized view for org statistics
CREATE MATERIALIZED VIEW org_stats AS
SELECT
  o.id as org_id,
  o.name,
  COUNT(DISTINCT t.id) as total_trips,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED') as completed_trips,
  COUNT(DISTINCT d.id) as total_drivers,
  COUNT(DISTINCT tr.id) as total_trucks,
  SUM(i.amount) as total_invoices,
  SUM(p.amount) as total_payments
FROM "Org" o
LEFT JOIN "Trip" t ON t."sourceMahajanId" = o.id OR t."destinationMahajanId" = o.id
LEFT JOIN "DriverProfile" d ON d."orgId" = o.id
LEFT JOIN "Truck" tr ON tr."orgId" = o.id
LEFT JOIN "Account" a ON a."ownerOrgId" = o.id
LEFT JOIN "Invoice" i ON i."accountId" = a.id
LEFT JOIN "Payment" p ON p."accountId" = a.id
GROUP BY o.id, o.name;

-- Refresh every hour
REFRESH MATERIALIZED VIEW CONCURRENTLY org_stats;
```

**Access via Prisma:**
```typescript
const stats = await prisma.$queryRaw`
  SELECT * FROM org_stats WHERE org_id = ${orgId}
`;
```

---

### 13. **Implement Circuit Breaker for External Services**

**For S3, Redis, etc.**
```typescript
import CircuitBreaker from 'opossum';

const s3Breaker = new CircuitBreaker(async (command) => {
  return await s3Client.send(command);
}, {
  timeout: 3000,  // 3 seconds
  errorThresholdPercentage: 50,
  resetTimeout: 30000,  // 30 seconds
});

s3Breaker.on('open', () => {
  logger.error('S3 circuit breaker opened - too many failures');
});

// Usage
const result = await s3Breaker.fire(command);
```

---

## 📊 Performance Monitoring

### Key Metrics to Track

1. **Response Time**
   - P50: 50th percentile
   - P95: 95th percentile
   - P99: 99th percentile

2. **Throughput**
   - Requests per second
   - Concurrent connections

3. **Database**
   - Query time
   - Connection pool usage
   - Slow queries (>100ms)

4. **Redis**
   - Hit rate
   - Memory usage
   - Evictions

5. **WebSocket**
   - Connected clients
   - Message rate
   - Broadcast latency

### Monitoring Tools

```typescript
// Add request timing middleware
import responseTime from 'response-time';

app.use(responseTime((req, res, time) => {
  logger.info('Request completed', {
    method: req.method,
    url: req.url,
    statusCode: res.statusCode,
    responseTime: time,
  });

  // Send to monitoring service (Datadog, New Relic, etc.)
  // metrics.timing('http.request', time, {
  //   method: req.method,
  //   route: req.route?.path,
  //   status: res.statusCode,
  // });
}));
```

---

## 🚀 Load Testing

### Artillery Configuration
```yaml
# artillery.yml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10  # 10 users per second
      name: "Warm up"
    - duration: 120
      arrivalRate: 50  # 50 users per second
      name: "Load test"
    - duration: 60
      arrivalRate: 100  # 100 users per second
      name: "Stress test"

scenarios:
  - name: "Get trips"
    flow:
      - post:
          url: "/api/v1/auth/login"
          json:
            phone: "{{ phone }}"
            password: "{{ password }}"
          capture:
            json: "$.data.accessToken"
            as: "token"
      - get:
          url: "/api/v1/trips"
          headers:
            Authorization: "Bearer {{ token }}"
      - think: 2  # Wait 2 seconds

  - name: "Track location"
    flow:
      - post:
          url: "/api/v1/tracking/ping"
          headers:
            Authorization: "Bearer {{ driverToken }}"
          json:
            tripId: "{{ tripId }}"
            driverId: "{{ driverId }}"
            locations:
              - latitude: 40.7128
                longitude: -74.0060
                timestamp: "{{ $timestamp }}"
      - think: 5  # Wait 5 seconds (simulating 5-second GPS interval)
```

**Run load test:**
```bash
npm install -g artillery
artillery run artillery.yml
```

---

## 📈 Expected Performance Targets

### API Response Times (P95)
- **Simple reads** (GET /trips/:id): <100ms
- **Complex reads** (GET /trips with includes): <200ms
- **Writes** (POST /trips): <300ms
- **Location tracking** (POST /tracking/ping): <150ms

### Database Query Times
- **Indexed queries**: <10ms
- **Aggregations**: <50ms
- **Writes**: <20ms

### WebSocket Latency
- **Room join**: <50ms
- **Broadcast delivery**: <100ms

### System Capacity
- **Concurrent users**: 10,000+
- **Requests per second**: 1,000+
- **Location pings per second**: 500+

---

## ✅ Performance Checklist

- [ ] Add database indexes (Issue #9)
- [ ] Implement Redis caching
- [ ] Optimize N+1 queries
- [ ] Configure connection pooling
- [ ] Add response compression
- [ ] Implement HTTP caching headers
- [ ] Set up read replicas (production)
- [ ] Add performance monitoring
- [ ] Run load tests
- [ ] Document performance SLAs

---

Let me know if you want detailed implementation for any of these optimizations!
