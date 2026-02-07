/**
 * Chat System Integration Test
 *
 * Tests the full chat flow between two Mahajan users:
 *  - Thread creation (account-based)
 *  - Sending TEXT messages
 *  - Delivery acknowledgment (single tick)
 *  - Read receipts (double tick)
 *  - Sending IMAGE/FILE messages with attachments
 *  - Reply-to messages
 *  - Message listing with attachments & reply context
 *
 * Prerequisites:
 *  - Server running (npm run dev)
 *  - Database seeded (npm run prisma:seed)
 *  - Redis running
 *
 * Usage:
 *   npx tsx scripts/test-chat.ts
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || '';

if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET or JWT_ACCESS_SECRET must be set in .env');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function api(
  method: string,
  path: string,
  token: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ─── Lookup seed users from DB via a helper endpoint ─────

async function generateToken(userId: string, phone: string, role: string): string {
  return jwt.sign(
    { userId, phone, role, type: 'access' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ─── Main Test ───────────────────────────────────────────

async function main() {
  console.log('\n🧪 Chat System Integration Test');
  console.log(`   Server: ${BASE_URL}\n`);

  // Step 0: Fetch users and account from DB to get IDs
  // Use the app's configured Prisma client (requires pg adapter)
  const { default: prisma } = await import('../src/config/database');

  try {
    const mahajan1 = await prisma.user.findUnique({ where: { phone: '+916202923165' } });
    const mahajan2 = await prisma.user.findUnique({ where: { phone: '+919876543211' } });

    if (!mahajan1 || !mahajan2) {
      console.error('ERROR: Seed users not found. Run: npm run prisma:seed');
      process.exit(1);
    }

    // Find the ledger account between their orgs
    const membership1 = await prisma.orgMember.findFirst({ where: { userId: mahajan1.id } });
    const membership2 = await prisma.orgMember.findFirst({ where: { userId: mahajan2.id } });

    if (!membership1 || !membership2) {
      console.error('ERROR: Org memberships not found');
      process.exit(1);
    }

    const account = await prisma.account.findUnique({
      where: {
        ownerOrgId_counterpartyOrgId: {
          ownerOrgId: membership1.orgId,
          counterpartyOrgId: membership2.orgId,
        },
      },
    });

    if (!account) {
      console.error('ERROR: Ledger account not found. Run: npm run prisma:seed');
      process.exit(1);
    }

    // Find a trip between the two orgs (for trip-based thread test)
    const trip = await prisma.trip.findFirst({
      where: {
        sourceOrgId: membership1.orgId,
        destinationOrgId: membership2.orgId,
      },
    });

    // Generate JWT tokens for both users
    const token1 = await generateToken(mahajan1.id, mahajan1.phone, mahajan1.role);
    const token2 = await generateToken(mahajan2.id, mahajan2.phone, mahajan2.role);

    console.log(`   User 1: ${mahajan1.name} (${mahajan1.phone})`);
    console.log(`   User 2: ${mahajan2.name} (${mahajan2.phone})`);
    console.log(`   Account: ${account.id}`);
    console.log(`   Trip: ${trip?.id || 'N/A'}\n`);

    // ─── TEST 1: Create/Get Account Thread ──────────────
    console.log('── TEST 1: Create Account-Based Chat Thread ──');

    const r1 = await api('POST', '/api/v1/chat/threads', token1, {
      accountId: account.id,
    });
    assert(r1.status === 200 || r1.status === 201, 'Create/get thread returns 200 or 201', `got ${r1.status}`);
    assert(r1.data.success === true, 'Response success=true');
    assert(!!r1.data.data?.id, 'Thread has an ID');

    const threadId = r1.data.data?.id;

    // User 2 should also be able to access the same thread
    const r1b = await api('POST', '/api/v1/chat/threads', token2, {
      accountId: account.id,
    });
    assert(r1b.status === 200, 'User 2 gets existing thread (200)', `got ${r1b.status}`);
    assert(r1b.data.data?.id === threadId, 'Same thread ID returned for both users');
    console.log('');

    // ─── TEST 2: Send TEXT Messages ─────────────────────
    console.log('── TEST 2: Send TEXT Messages ──');

    const r2 = await api('POST', `/api/v1/chat/threads/${threadId}/messages`, token1, {
      content: 'Hello Suresh! Shipment is on the way.',
      messageType: 'TEXT',
    });
    assert(r2.status === 201, 'User 1 sends TEXT message (201)', `got ${r2.status}: ${JSON.stringify(r2.data)}`);
    assert(r2.data.data?.content === 'Hello Suresh! Shipment is on the way.', 'Message content matches');
    assert(r2.data.data?.messageType === 'TEXT', 'messageType is TEXT');
    assert(r2.data.data?.senderUser?.id === mahajan1.id, 'Sender is User 1');

    const msg1Id = r2.data.data?.id;

    const r2b = await api('POST', `/api/v1/chat/threads/${threadId}/messages`, token2, {
      content: 'Thanks Rajesh! When will it arrive?',
      messageType: 'TEXT',
    });
    assert(r2b.status === 201, 'User 2 sends TEXT reply (201)', `got ${r2b.status}`);
    assert(r2b.data.data?.senderUser?.id === mahajan2.id, 'Sender is User 2');

    const msg2Id = r2b.data.data?.id;
    console.log('');

    // ─── TEST 3: Reply-To Messages ──────────────────────
    console.log('── TEST 3: Reply-To Messages ──');

    const r3 = await api('POST', `/api/v1/chat/threads/${threadId}/messages`, token1, {
      content: 'ETA is 2 hours from Nashik.',
      messageType: 'TEXT',
      replyToId: msg2Id,
    });
    assert(r3.status === 201, 'User 1 sends reply-to message (201)', `got ${r3.status}: ${JSON.stringify(r3.data)}`);
    assert(r3.data.data?.replyTo?.id === msg2Id, 'replyTo contains referenced message ID');
    assert(!!r3.data.data?.replyTo?.senderUser?.name, 'replyTo includes sender name');
    console.log('');

    // ─── TEST 4: Get Messages (with attachments & reply context) ──
    console.log('── TEST 4: Get Messages ──');

    const r4 = await api('GET', `/api/v1/chat/threads/${threadId}/messages?limit=50`, token1);
    assert(r4.status === 200, 'Get messages returns 200', `got ${r4.status}`);
    assert(r4.data.data?.messages?.length >= 3, `At least 3 messages (got ${r4.data.data?.messages?.length})`);

    const messages = r4.data.data?.messages || [];
    const replyMsg = messages.find((m: any) => m.replyToId);
    assert(!!replyMsg, 'Reply message found in listing');
    assert(!!replyMsg?.replyTo?.content, 'Reply context includes content');
    assert(Array.isArray(replyMsg?.attachments), 'Message has attachments array');

    // Check delivery/read status fields are present
    if (messages.length > 0) {
      const anyMsg = messages[0];
      assert('isDelivered' in anyMsg, 'Message has isDelivered field');
      assert('isRead' in anyMsg, 'Message has isRead field');
      assert('deliveredAt' in anyMsg, 'Message has deliveredAt field');
      assert('readAt' in anyMsg, 'Message has readAt field');
    } else {
      assert(false, 'No messages to check delivery/read fields');
    }
    console.log('');

    // ─── TEST 5: Delivery Acknowledgment (Single Tick) ──
    console.log('── TEST 5: Delivery Acknowledgment ──');

    const r5 = await api('POST', `/api/v1/chat/threads/${threadId}/delivered`, token2);
    assert(r5.status === 200, 'Mark as delivered returns 200', `got ${r5.status}: ${JSON.stringify(r5.data)}`);
    assert(typeof r5.data.data?.count === 'number', `Delivered count is a number (${r5.data.data?.count})`);

    // Verify messages are now marked as delivered
    const r5b = await api('GET', `/api/v1/chat/threads/${threadId}/messages?limit=50`, token2);
    const deliveredMsgs = (r5b.data.data?.messages || []).filter(
      (m: any) => m.senderUser?.id === mahajan1.id && m.isDelivered === true
    );
    assert(deliveredMsgs.length > 0, `User 1's messages are marked delivered (${deliveredMsgs.length})`);
    console.log('');

    // ─── TEST 6: Read Receipts (Double Tick) ────────────
    console.log('── TEST 6: Read Receipts ──');

    const r6 = await api('POST', `/api/v1/chat/threads/${threadId}/read`, token2);
    assert(r6.status === 200, 'Mark as read returns 200', `got ${r6.status}`);
    assert(typeof r6.data.data?.count === 'number', `Read count is a number (${r6.data.data?.count})`);

    // Verify messages are marked as read
    const r6b = await api('GET', `/api/v1/chat/threads/${threadId}/messages?limit=50`, token2);
    const readMsgs = (r6b.data.data?.messages || []).filter(
      (m: any) => m.senderUser?.id === mahajan1.id && m.isRead === true
    );
    assert(readMsgs.length > 0, `User 1's messages are marked read (${readMsgs.length})`);
    console.log('');

    // ─── TEST 7: Validation — TEXT requires content ─────
    console.log('── TEST 7: Validation ──');

    const r7a = await api('POST', `/api/v1/chat/threads/${threadId}/messages`, token1, {
      messageType: 'TEXT',
      // No content → should fail
    });
    assert(r7a.status === 400, 'TEXT without content returns 400', `got ${r7a.status}`);

    const r7b = await api('POST', `/api/v1/chat/threads/${threadId}/messages`, token1, {
      messageType: 'IMAGE',
      // No attachmentIds → should fail
    });
    assert(r7b.status === 400, 'IMAGE without attachments returns 400', `got ${r7b.status}`);

    // Invalid replyToId
    const r7c = await api('POST', `/api/v1/chat/threads/${threadId}/messages`, token1, {
      content: 'test',
      messageType: 'TEXT',
      replyToId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx', // non-existent
    });
    assert(r7c.status === 400 || r7c.status === 422, 'Invalid replyToId returns 400/422', `got ${r7c.status}`);
    console.log('');

    // ─── TEST 8: File/Attachment Upload Flow ────────────
    console.log('── TEST 8: File Upload + Chat Attachment ──');

    // Step 1: Request presigned upload URL
    const r8a = await api('POST', '/api/v1/files/presigned-url', token1, {
      filename: 'load-photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 500000,
      purpose: 'CHAT_ATTACHMENT',
    });

    if (r8a.status === 200 || r8a.status === 201) {
      assert(true, 'Presigned URL generated');
      assert(!!r8a.data.data?.fileId, `File ID: ${r8a.data.data?.fileId}`);
      assert(!!r8a.data.data?.uploadUrl, 'Upload URL returned');

      const fileId = r8a.data.data?.fileId;

      // Step 2: We can't actually upload to S3 in this test, but we can test
      // that sending a message with an unconfirmed attachment is rejected
      const r8b = await api('POST', `/api/v1/chat/threads/${threadId}/messages`, token1, {
        messageType: 'IMAGE',
        attachmentIds: [fileId],
        content: 'Check this photo',
      });
      assert(
        r8b.status === 400 || r8b.status === 422,
        'Pending (unconfirmed) attachment rejected',
        `got ${r8b.status}: ${r8b.data?.message || ''}`
      );
    } else {
      console.log(`  ⚠️ Presigned URL request failed (${r8a.status}), skipping file tests`);
      console.log(`     This may be expected if S3/MinIO is not configured`);
    }
    console.log('');

    // ─── TEST 9: Trip-Based Thread ──────────────────────
    if (trip) {
      console.log('── TEST 9: Trip-Based Chat Thread ──');

      const r9 = await api('POST', '/api/v1/chat/threads', token1, {
        tripId: trip.id,
      });
      assert(r9.status === 200 || r9.status === 201, 'Create trip thread', `got ${r9.status}`);
      assert(!!r9.data.data?.id, 'Trip thread has ID');

      const tripThreadId = r9.data.data?.id;

      // User 2 sends a message in trip thread
      const r9b = await api('POST', `/api/v1/chat/threads/${tripThreadId}/messages`, token2, {
        content: 'Received the goods, minor shortage in cabbage.',
        messageType: 'TEXT',
      });
      assert(r9b.status === 201, 'User 2 sends message in trip thread', `got ${r9b.status}`);
      console.log('');
    }

    // ─── TEST 10: Thread List & Unread Counts ───────────
    console.log('── TEST 10: Thread List & Unread Counts ──');

    const r10a = await api('GET', '/api/v1/chat/threads', token1);
    assert(r10a.status === 200, 'Get threads returns 200', `got ${r10a.status}`);
    assert(Array.isArray(r10a.data.data), 'Threads is an array');
    assert(r10a.data.data?.length > 0, `Has threads (${r10a.data.data?.length})`);

    // Check thread has lastMessageText
    const thread = r10a.data.data?.[0];
    assert(!!thread?.lastMessageText || thread?.lastMessageText === null, 'Thread has lastMessageText field');
    assert('unreadCount' in thread, 'Thread has unreadCount field');

    const r10b = await api('GET', '/api/v1/chat/unread', token1);
    assert(r10b.status === 200, 'Get unread counts returns 200', `got ${r10b.status}`);
    assert(Array.isArray(r10b.data.data), 'Unread data is an array');
    console.log('');

    // ─── TEST 11: Pin / Archive ─────────────────────────
    console.log('── TEST 11: Pin & Archive ──');

    const r11a = await api('POST', `/api/v1/chat/threads/${threadId}/pin`, token1, {
      isPinned: true,
    });
    assert(r11a.status === 200, 'Pin thread returns 200', `got ${r11a.status}`);
    assert(r11a.data.data?.isPinned === true, 'Thread is pinned');

    const r11b = await api('POST', `/api/v1/chat/threads/${threadId}/pin`, token1, {
      isPinned: false,
    });
    assert(r11b.status === 200, 'Unpin thread returns 200', `got ${r11b.status}`);
    assert(r11b.data.data?.isPinned === false, 'Thread is unpinned');

    const r11c = await api('POST', `/api/v1/chat/threads/${threadId}/archive`, token1, {
      isArchived: true,
    });
    assert(r11c.status === 200, 'Archive thread returns 200', `got ${r11c.status}`);

    const r11d = await api('POST', `/api/v1/chat/threads/${threadId}/archive`, token1, {
      isArchived: false,
    });
    assert(r11d.status === 200, 'Unarchive thread returns 200', `got ${r11d.status}`);
    console.log('');

    // ─── TEST 12: Search Messages ───────────────────────
    console.log('── TEST 12: Search Messages ──');

    const r12 = await api(
      'GET',
      `/api/v1/chat/search?orgId=${membership1.orgId}&query=shipment`,
      token1
    );
    assert(r12.status === 200, 'Search returns 200', `got ${r12.status}`);
    assert(Array.isArray(r12.data.data), 'Search results is an array');
    console.log('');

    // ─── Cleanup: Remove test messages ──────────────────
    // (optional — leave messages for manual inspection)

    // ─── Summary ────────────────────────────────────────
    console.log('═══════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════\n');

    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n💥 Test crashed:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
