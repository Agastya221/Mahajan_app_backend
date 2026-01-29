# Testing Recommendations & Test Cases

## Testing Strategy

### Test Pyramid
```
        /\
       /E2E\          10% - End-to-end tests
      /------\
     /Integration\    30% - Integration tests
    /------------\
   /  Unit Tests  \   60% - Unit tests
  /----------------\
```

---

## 🔴 Critical Test Cases (Must Have Before Production)

### 1. **Race Condition Tests for Trip Creation**

**Test:** Concurrent trip creation with same driver/truck
```typescript
describe('Trip Creation Race Condition', () => {
  it('should prevent two trips from being created simultaneously for same driver', async () => {
    const driverId = 'test-driver-id';
    const truckId = 'test-truck-id';

    // Create two trips concurrently
    const [result1, result2] = await Promise.allSettled([
      tripService.createTrip({
        sourceMahajanId: 'org1',
        destinationMahajanId: 'org2',
        driverId,
        truckId,
        startPoint: 'A',
        endPoint: 'B',
      }, 'user1'),
      tripService.createTrip({
        sourceMahajanId: 'org1',
        destinationMahajanId: 'org3',
        driverId,
        truckId,
        startPoint: 'C',
        endPoint: 'D',
      }, 'user1'),
    ]);

    // Exactly one should succeed
    const succeeded = [result1, result2].filter(r => r.status === 'fulfilled');
    const failed = [result1, result2].filter(r => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain('already has an active trip');
  });
});
```

---

### 2. **Ledger Balance Synchronization Tests**

**Test:** Concurrent invoice/payment operations
```typescript
describe('Ledger Balance Sync', () => {
  it('should maintain balance consistency under concurrent transactions', async () => {
    const accountId = 'test-account-id';

    // Create multiple invoices concurrently
    await Promise.all([
      ledgerService.createInvoice({
        accountId,
        invoiceNumber: 'INV001',
        amount: 100,
      }, 'user1'),
      ledgerService.createInvoice({
        accountId,
        invoiceNumber: 'INV002',
        amount: 200,
      }, 'user1'),
      ledgerService.createPayment({
        accountId,
        amount: 50,
        tag: 'PARTIAL',
        paymentMethod: 'CASH',
      }, 'user1'),
    ]);

    // Check final balances
    const account = await prisma.account.findUnique({
      where: { id: accountId }
    });

    const mirrorAccount = await prisma.account.findUnique({
      where: {
        ownerOrgId_counterpartyOrgId: {
          ownerOrgId: account.counterpartyOrgId,
          counterpartyOrgId: account.ownerOrgId,
        }
      }
    });

    // Balance should be: +100 +200 -50 = 250
    expect(account.balance).toBe(250);
    expect(mirrorAccount.balance).toBe(-250);

    // Verify ledger entries match
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId }
    });

    const totalDebits = entries
      .filter(e => e.direction === 'DEBIT')
      .reduce((sum, e) => sum + e.amount, 0);

    const totalCredits = entries
      .filter(e => e.direction === 'CREDIT')
      .reduce((sum, e) => sum + e.amount, 0);

    expect(totalDebits - totalCredits).toBe(account.balance);
  });
});
```

---

### 3. **Trip Status Transition Tests**

**Test:** Invalid status transitions
```typescript
describe('Trip Status Transitions', () => {
  it('should reject invalid status transitions', async () => {
    const trip = await createTestTrip({ status: 'COMPLETED' });

    // Cannot change COMPLETED → IN_TRANSIT
    await expect(
      tripService.updateTripStatus(
        trip.id,
        { status: 'IN_TRANSIT' },
        'user1'
      )
    ).rejects.toThrow('Cannot transition from COMPLETED to IN_TRANSIT');
  });

  it('should prevent load card creation on non-CREATED trip', async () => {
    const trip = await createTestTrip({ status: 'CANCELLED' });

    await expect(
      tripService.createLoadCard(
        trip.id,
        {
          quantity: 100,
          unit: 'kg',
          attachmentIds: ['file1'],
        },
        'user1'
      )
    ).rejects.toThrow('Cannot create load card for trip in CANCELLED status');
  });

  it('should enforce correct load/receive card sequence', async () => {
    const trip = await createTestTrip({ status: 'CREATED' });

    // Cannot create receive card before load card
    await expect(
      tripService.createReceiveCard(
        trip.id,
        {
          receivedQuantity: 90,
          unit: 'kg',
          attachmentIds: ['file1'],
        },
        'user1'
      )
    ).rejects.toThrow('Load card must be created before receive card');
  });
});
```

---

### 4. **Authorization Tests**

**Test:** Cross-organization access attempts
```typescript
describe('Authorization', () => {
  it('should prevent user from accessing trips of other orgs', async () => {
    const org1User = await createUser({ orgId: 'org1' });
    const org2Trip = await createTestTrip({
      sourceMahajanId: 'org2',
      destinationMahajanId: 'org3',
    });

    // User from org1 should not see org2's trips
    await expect(
      tripService.getTripById(org2Trip.id, org1User.id)
    ).rejects.toThrow('Not authorized to view this trip');
  });

  it('should prevent unauthorized users from listing org trips', async () => {
    const outsiderUser = await createUser({ orgId: 'other-org' });

    await expect(
      tripService.getTrips({
        orgId: 'protected-org',
        userId: outsiderUser.id,
      })
    ).rejects.toThrow('Not a member of this organization');
  });

  it('should allow destination org to view trip', async () => {
    const destUser = await createUser({ orgId: 'dest-org' });
    const trip = await createTestTrip({
      sourceMahajanId: 'source-org',
      destinationMahajanId: 'dest-org',
    });

    const result = await tripService.getTripById(trip.id, destUser.id);
    expect(result.id).toBe(trip.id);
  });
});
```

---

### 5. **Location Tracking Tests**

**Test:** Stale location handling
```typescript
describe('Location Tracking', () => {
  it('should not update latest location with stale data', async () => {
    const tripId = 'test-trip';

    // Store location at 10:00
    await trackingService.storePings(tripId, 'driver1', [{
      latitude: 40.7128,
      longitude: -74.0060,
      timestamp: '2024-01-15T10:00:00Z',
      batchId: 'batch1',
    }]);

    // Store newer location at 10:05
    await trackingService.storePings(tripId, 'driver1', [{
      latitude: 40.7150,
      longitude: -74.0070,
      timestamp: '2024-01-15T10:05:00Z',
      batchId: 'batch2',
    }]);

    // Try to store old location at 10:02 (should be ignored for latest)
    await trackingService.storePings(tripId, 'driver1', [{
      latitude: 40.7100,
      longitude: -74.0050,
      timestamp: '2024-01-15T10:02:00Z',
      batchId: 'batch3',
    }]);

    const latest = await prisma.tripLatestLocation.findUnique({
      where: { tripId }
    });

    // Latest should still be 10:05 location
    expect(latest.latitude).toBe(40.7150);
    expect(latest.timestamp.toISOString()).toBe('2024-01-15T10:05:00.000Z');

    // But all locations should be in history
    const history = await prisma.tripLocation.findMany({
      where: { tripId }
    });
    expect(history).toHaveLength(3);
  });

  it('should reject duplicate batch IDs', async () => {
    const tripId = 'test-trip';

    // Store batch1
    await trackingService.storePings(tripId, 'driver1', [{
      latitude: 40.7128,
      longitude: -74.0060,
      timestamp: '2024-01-15T10:00:00Z',
      batchId: 'batch1',
    }]);

    // Try to store batch1 again
    const result = await trackingService.storePings(tripId, 'driver1', [{
      latitude: 40.7128,
      longitude: -74.0060,
      timestamp: '2024-01-15T10:00:00Z',
      batchId: 'batch1',
    }]);

    expect(result.stored).toBe(0);
    expect(result.message).toContain('Duplicate batch detected');
  });

  it('should validate timestamp is within acceptable range', async () => {
    const tripId = 'test-trip';

    // Future timestamp (should fail)
    await expect(
      trackingService.storePings(tripId, 'driver1', [{
        latitude: 40.7128,
        longitude: -74.0060,
        timestamp: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours future
      }])
    ).rejects.toThrow('Timestamp must be within acceptable range');
  });
});
```

---

### 6. **Unit Mismatch Tests**

**Test:** Load/Receive card unit validation
```typescript
describe('Load/Receive Card Units', () => {
  it('should reject receive card with different unit than load card', async () => {
    const trip = await createTestTrip({
      status: 'REACHED',
      loadCard: {
        quantity: 100,
        unit: 'kg',
      },
    });

    await expect(
      tripService.createReceiveCard(
        trip.id,
        {
          receivedQuantity: 90,
          unit: 'boxes',  // ❌ Different unit
          attachmentIds: ['file1'],
        },
        'user1'
      )
    ).rejects.toThrow('Receive card unit (boxes) must match load card unit (kg)');
  });

  it('should calculate shortage correctly with matching units', async () => {
    const trip = await createTestTrip({
      status: 'REACHED',
      loadCard: {
        quantity: 100,
        unit: 'kg',
      },
    });

    const receiveCard = await tripService.createReceiveCard(
      trip.id,
      {
        receivedQuantity: 95,
        unit: 'kg',
        attachmentIds: ['file1'],
      },
      'user1'
    );

    expect(receiveCard.shortage).toBe(5);
  });
});
```

---

### 7. **File Upload Tests**

**Test:** S3 verification
```typescript
describe('File Upload', () => {
  it('should verify file exists in S3 before confirming', async () => {
    const presignedUrl = await fileService.generatePresignedUrl({
      filename: 'test.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    }, 'user1');

    // Try to confirm without actually uploading
    await expect(
      fileService.confirmUpload(
        presignedUrl.fileId,
        presignedUrl.s3Key,
        'user1'
      )
    ).rejects.toThrow('File not found in S3');
  });

  it('should validate file size matches expected', async () => {
    const presignedUrl = await fileService.generatePresignedUrl({
      filename: 'test.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    }, 'user1');

    // Upload file with different size
    await uploadToS3(presignedUrl.uploadUrl, Buffer.alloc(2048));

    await expect(
      fileService.confirmUpload(
        presignedUrl.fileId,
        presignedUrl.s3Key,
        'user1'
      )
    ).rejects.toThrow('File size mismatch');
  });
});
```

---

### 8. **WebSocket Authorization Tests**

**Test:** Room access control
```typescript
describe('WebSocket Authorization', () => {
  it('should disconnect socket after repeated auth failures', async () => {
    const socket = await connectSocket(validToken);

    // Try to join unauthorized trips 3 times
    socket.emit('tracking:subscribe', { tripId: 'unauthorized1' });
    await waitForEvent(socket, 'error');

    socket.emit('tracking:subscribe', { tripId: 'unauthorized2' });
    await waitForEvent(socket, 'error');

    socket.emit('tracking:subscribe', { tripId: 'unauthorized3' });

    // Should be disconnected after 3 failures
    await waitForEvent(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('should prevent joining trip room without authorization', async () => {
    const org1User = await createUser({ orgId: 'org1' });
    const org2Trip = await createTestTrip({
      sourceMahajanId: 'org2',
      destinationMahajanId: 'org3',
    });

    const socket = await connectSocket(getUserToken(org1User));

    socket.emit('tracking:subscribe', { tripId: org2Trip.id });

    const error = await waitForEvent(socket, 'error');
    expect(error.message).toContain('Not authorized to view this trip');

    // Should not be in room
    const rooms = Array.from(socket.rooms);
    expect(rooms).not.toContain(`trip:${org2Trip.id}`);
  });
});
```

---

## 🟡 Integration Tests

### 9. **Full Trip Lifecycle Test**
```typescript
describe('Trip Lifecycle Integration', () => {
  it('should complete full trip workflow', async () => {
    // 1. Create trip
    const trip = await tripService.createTrip({
      sourceMahajanId: 'org1',
      destinationMahajanId: 'org2',
      driverId: 'driver1',
      truckId: 'truck1',
      startPoint: 'Mumbai',
      endPoint: 'Delhi',
    }, 'user1');

    expect(trip.status).toBe('CREATED');

    // 2. Create load card
    const loadCard = await tripService.createLoadCard(
      trip.id,
      {
        quantity: 1000,
        unit: 'kg',
        attachmentIds: ['file1', 'file2'],
      },
      'user1'
    );

    // Status should auto-update to LOADED
    const afterLoad = await prisma.trip.findUnique({
      where: { id: trip.id }
    });
    expect(afterLoad.status).toBe('LOADED');

    // 3. Update status to IN_TRANSIT
    await tripService.updateTripStatus(
      trip.id,
      { status: 'IN_TRANSIT' },
      'user1'
    );

    // 4. Send location pings
    await trackingService.storePings(trip.id, 'driver1', [
      {
        latitude: 19.0760,
        longitude: 72.8777,
        timestamp: new Date().toISOString(),
      },
    ]);

    // 5. Update to REACHED
    await tripService.updateTripStatus(
      trip.id,
      { status: 'REACHED' },
      'user1'
    );

    // 6. Create receive card
    const receiveCard = await tripService.createReceiveCard(
      trip.id,
      {
        receivedQuantity: 980,
        unit: 'kg',
        attachmentIds: ['file3'],
      },
      'user2' // Destination org user
    );

    expect(receiveCard.shortage).toBe(20);

    // Status should auto-update to COMPLETED
    const final = await prisma.trip.findUnique({
      where: { id: trip.id }
    });
    expect(final.status).toBe('COMPLETED');

    // Verify events
    const events = await prisma.tripEvent.findMany({
      where: { tripId: trip.id },
      orderBy: { timestamp: 'asc' },
    });

    expect(events).toHaveLength(5);
    expect(events[0].eventType).toBe('TRIP_CREATED');
    expect(events[1].eventType).toBe('LOAD_COMPLETED');
    expect(events[2].eventType).toBe('IN_TRANSIT');
    expect(events[3].eventType).toBe('ARRIVED');
    expect(events[4].eventType).toBe('TRIP_COMPLETED');
  });
});
```

---

### 10. **Ledger + Chat Integration Test**
```typescript
describe('Ledger Chat Integration', () => {
  it('should auto-create chat message when payment is recorded', async () => {
    // 1. Create account
    const { account } = await ledgerService.createOrGetAccount({
      ownerOrgId: 'org1',
      counterpartyOrgId: 'org2',
    }, 'user1');

    // 2. Create invoice
    await ledgerService.createInvoice({
      accountId: account.id,
      invoiceNumber: 'INV001',
      amount: 5000,
    }, 'user1');

    // 3. Record payment
    const result = await ledgerService.createPayment({
      accountId: account.id,
      amount: 2000,
      tag: 'PARTIAL',
      paymentMethod: 'UPI',
      remarks: 'First installment',
    }, 'user1');

    // 4. Verify chat message created
    expect(result.chatMessage).toBeDefined();
    expect(result.chatMessage.content).toContain('₹2000');
    expect(result.chatMessage.content).toContain('UPI');
    expect(result.chatMessage.paymentId).toBe(result.payment.id);

    // 5. Verify message is in thread
    const thread = await prisma.chatThread.findUnique({
      where: { id: result.threadId },
      include: { messages: true },
    });

    expect(thread.messages).toHaveLength(1);
    expect(thread.accountId).toBe(account.id);
  });
});
```

---

## 🟢 Edge Cases & Error Scenarios

### 11. **Decimal Precision Tests**
```typescript
describe('Decimal Precision', () => {
  it('should handle currency amounts correctly', async () => {
    // Test floating point issues
    const amount1 = 0.1 + 0.2; // In JS: 0.30000000000000004

    await expect(
      ledgerService.createInvoice({
        accountId: 'account1',
        invoiceNumber: 'INV001',
        amount: amount1,
      }, 'user1')
    ).rejects.toThrow('Amount can have at most 2 decimal places');

    // Should accept properly rounded amounts
    const invoice = await ledgerService.createInvoice({
      accountId: 'account1',
      invoiceNumber: 'INV002',
      amount: 0.30,
    }, 'user1');

    expect(invoice.amount).toBe(0.30);
  });

  it('should reject amounts with more than 2 decimal places', async () => {
    await expect(
      ledgerService.createInvoice({
        accountId: 'account1',
        invoiceNumber: 'INV001',
        amount: 123.456,
      }, 'user1')
    ).rejects.toThrow('Amount can have at most 2 decimal places');
  });
});
```

---

### 12. **Input Sanitization Tests**
```typescript
describe('Input Sanitization', () => {
  it('should trim whitespace from inputs', async () => {
    const org = await orgService.createOrg({
      name: '  Test Org  ',
      city: '  Mumbai  ',
      phone: '1234567890',
      address: '  123 Street  ',
    }, 'user1');

    expect(org.name).toBe('Test Org');
    expect(org.city).toBe('Mumbai');
    expect(org.address).toBe('123 Street');
  });

  it('should reject excessively long inputs', async () => {
    await expect(
      tripService.createTrip({
        sourceMahajanId: 'org1',
        destinationMahajanId: 'org2',
        driverId: 'driver1',
        truckId: 'truck1',
        startPoint: 'A'.repeat(300), // Too long
        endPoint: 'B',
      }, 'user1')
    ).rejects.toThrow('too long');
  });

  it('should handle special characters safely', async () => {
    const message = await chatService.sendMessage(
      'thread1',
      {
        content: '<script>alert("xss")</script>',
      },
      'user1'
    );

    // Content should be stored as-is (frontend should escape)
    expect(message.content).toBe('<script>alert("xss")</script>');
  });
});
```

---

## 📊 Test Coverage Goals

### Minimum Coverage Requirements
- **Critical paths:** 100% coverage
- **Business logic:** 90% coverage
- **Controllers:** 80% coverage
- **Utilities:** 95% coverage
- **Overall:** 85% coverage

### Coverage Commands
```bash
# Run tests with coverage
npm run test:coverage

# View coverage report
npm run test:coverage:report

# Coverage thresholds in jest.config.js
coverageThreshold: {
  global: {
    branches: 85,
    functions: 85,
    lines: 85,
    statements: 85
  }
}
```

---

## 🛠️ Testing Setup

### Install Dependencies
```bash
npm install --save-dev \
  jest \
  @types/jest \
  ts-jest \
  supertest \
  @types/supertest \
  socket.io-client \
  @faker-js/faker \
  nock
```

### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};
```

### Test Database Setup
```typescript
// tests/setup.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL,
    },
  },
});

beforeAll(async () => {
  // Run migrations
  await prisma.$executeRaw`DROP SCHEMA IF EXISTS public CASCADE`;
  await prisma.$executeRaw`CREATE SCHEMA public`;
  // Run: npx prisma migrate deploy
});

beforeEach(async () => {
  // Clear all tables
  await prisma.$transaction([
    prisma.chatMessage.deleteMany(),
    prisma.chatThread.deleteMany(),
    prisma.ledgerEntry.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.account.deleteMany(),
    prisma.tripLocation.deleteMany(),
    prisma.tripLatestLocation.deleteMany(),
    prisma.tripEvent.deleteMany(),
    prisma.tripReceiveCard.deleteMany(),
    prisma.tripLoadCard.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.truck.deleteMany(),
    prisma.driverProfile.deleteMany(),
    prisma.orgMember.deleteMany(),
    prisma.org.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

---

## 🚀 Continuous Integration

### GitHub Actions Workflow
```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test

      - name: Run tests
        run: npm run test:coverage
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          REDIS_HOST: localhost

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

---

## 📝 Testing Best Practices

1. **AAA Pattern:** Arrange, Act, Assert
2. **Test Isolation:** Each test should be independent
3. **Descriptive Names:** `it('should reject payment when account balance is insufficient')`
4. **Test One Thing:** One assertion per test (when possible)
5. **Use Factories:** Create test data with factories/fixtures
6. **Mock External Services:** Don't call real S3, payment gateways, etc.
7. **Test Error Paths:** Test failures as much as successes

---

## Next Steps

1. ✅ Set up Jest and testing infrastructure
2. ✅ Create test database and seed data
3. ✅ Write critical path tests first (issues #1-8)
4. ✅ Add integration tests for main workflows
5. ✅ Set up CI/CD pipeline
6. ✅ Add coverage reporting
7. ✅ Write load/performance tests for tracking endpoints

---

Let me know if you need help implementing any of these tests!
