import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { CreateThreadDto, SendMessageDto } from './chat.dto';
import { redisPublisher } from '../config/redis';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

// ✅ Helper: Normalize org pair ordering for consistent unique lookups
// Always stores the smaller cuid as orgId to prevent (A,B) vs (B,A) duplicates
function normalizeOrgPair(orgAId: string, orgBId: string): [string, string] {
  return orgAId < orgBId ? [orgAId, orgBId] : [orgBId, orgAId];
}

export class ChatService {

  // ============================================
  // ✅ CORE: Find or create org-pair thread
  // This is the single source of truth for thread creation
  // ============================================
  private async findOrCreateOrgPairThread(
    orgAId: string,
    orgBId: string,
    options?: { accountId?: string; include?: any }
  ) {
    const [firstOrgId, secondOrgId] = normalizeOrgPair(orgAId, orgBId);

    const includeClause = options?.include || {
      org: { select: { id: true, name: true, gstin: true } },
      counterpartyOrg: { select: { id: true, name: true, gstin: true } },
      account: {
        select: {
          id: true,
          ownerOrgId: true,
          counterpartyOrgId: true,
          balance: true,
        },
      },
    };

    // Try to find existing thread
    let thread = await prisma.chatThread.findUnique({
      where: {
        orgId_counterpartyOrgId: {
          orgId: firstOrgId,
          counterpartyOrgId: secondOrgId,
        },
      },
      include: includeClause,
    });

    if (thread) {
      // Optionally link account if not already linked
      if (options?.accountId && !thread.accountId) {
        thread = await prisma.chatThread.update({
          where: { id: thread.id },
          data: { accountId: options.accountId },
          include: includeClause,
        });
      }
      return { thread, isNew: false };
    }

    // Create new thread (with race condition handling)
    try {
      thread = await prisma.chatThread.create({
        data: {
          orgId: firstOrgId,
          counterpartyOrgId: secondOrgId,
          accountId: options?.accountId || null,
        },
        include: includeClause,
      });
      return { thread, isNew: true };
    } catch (error: any) {
      if (error.code === 'P2002') {
        // Race condition: another request created it first
        const raceThread = await prisma.chatThread.findUnique({
          where: {
            orgId_counterpartyOrgId: {
              orgId: firstOrgId,
              counterpartyOrgId: secondOrgId,
            },
          },
          include: includeClause,
        });
        if (!raceThread) {
          throw new Error('Thread creation failed and existing thread not found');
        }
        // Link account if needed
        if (options?.accountId && !raceThread.accountId) {
          const updated = await prisma.chatThread.update({
            where: { id: raceThread.id },
            data: { accountId: options.accountId },
            include: includeClause,
          });
          return { thread: updated, isNew: false };
        }
        return { thread: raceThread, isNew: false };
      }
      throw error;
    }
  }

  // ============================================
  // ✅ Create or get thread (API entry point)
  // Accepts: counterpartyOrgId, accountId, or tripId
  // ============================================
  async createOrGetThread(data: CreateThreadDto, userId: string) {
    // Determine the org pair
    let orgAId: string;
    let orgBId: string;
    let accountId: string | undefined;

    // Get user's org memberships
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const userOrgIds = memberships.map(m => m.orgId);

    if (userOrgIds.length === 0) {
      throw new ForbiddenError('User is not a member of any organization');
    }

    if (data.counterpartyOrgId) {
      // Direct org pair — verify user belongs to one of them
      if (userOrgIds.includes(data.counterpartyOrgId)) {
        throw new ValidationError('Cannot create a chat with your own organization');
      }
      // User's org is the first one that matches
      orgAId = userOrgIds[0]; // Primary org
      orgBId = data.counterpartyOrgId;

      // Verify counterparty org exists
      const counterpartyOrg = await prisma.org.findUnique({
        where: { id: data.counterpartyOrgId },
      });
      if (!counterpartyOrg) {
        throw new NotFoundError('Counterparty organization not found');
      }

      // Check if there's an account between these orgs, to auto-link
      const account = await prisma.account.findFirst({
        where: {
          OR: [
            { ownerOrgId: orgAId, counterpartyOrgId: orgBId },
            { ownerOrgId: orgBId, counterpartyOrgId: orgAId },
          ],
        },
      });
      accountId = account?.id;

    } else if (data.accountId) {
      // Resolve from account
      const account = await prisma.account.findUnique({
        where: { id: data.accountId },
      });
      if (!account) throw new NotFoundError('Account not found');

      // Verify user has access
      const hasAccess = userOrgIds.some(
        orgId => orgId === account.ownerOrgId || orgId === account.counterpartyOrgId
      );
      if (!hasAccess) throw new ForbiddenError('Not authorized to access this account');

      orgAId = account.ownerOrgId;
      orgBId = account.counterpartyOrgId;
      accountId = account.id;

    } else if (data.tripId) {
      // Resolve from trip (backward compat — frontend can still pass tripId)
      const trip = await prisma.trip.findUnique({
        where: { id: data.tripId },
      });
      if (!trip) throw new NotFoundError('Trip not found');

      // Verify user has access
      const hasAccess = userOrgIds.some(
        orgId => orgId === trip.sourceOrgId || orgId === trip.destinationOrgId
      );
      if (!hasAccess) throw new ForbiddenError('Not authorized to access this trip');

      orgAId = trip.sourceOrgId;
      orgBId = trip.destinationOrgId;

      // Check if there's an account between these orgs
      const account = await prisma.account.findFirst({
        where: {
          OR: [
            { ownerOrgId: orgAId, counterpartyOrgId: orgBId },
            { ownerOrgId: orgBId, counterpartyOrgId: orgAId },
          ],
        },
      });
      accountId = account?.id;

    } else {
      throw new ValidationError('counterpartyOrgId, accountId, or tripId is required');
    }

    return this.findOrCreateOrgPairThread(orgAId, orgBId, { accountId });
  }

  // ============================================
  // ✅ Get all threads for user
  // ============================================
  async getThreads(userId: string, filters?: { page?: number; limit?: number }) {
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });

    const orgIds = memberships.map(m => m.orgId);

    if (orgIds.length === 0) {
      return { threads: [] as any[], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }

    // Find threads where user's org is either side of the conversation
    const where: Prisma.ChatThreadWhereInput = {
      OR: [
        { orgId: { in: orgIds } },
        { counterpartyOrgId: { in: orgIds } },
      ],
    };

    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);

    const [threads, total] = await Promise.all([
      prisma.chatThread.findMany({
        where,
        include: {
          org: {
            select: { id: true, name: true, gstin: true },
          },
          counterpartyOrg: {
            select: { id: true, name: true, gstin: true },
          },
          account: {
            select: {
              id: true,
              ownerOrgId: true,
              counterpartyOrgId: true,
              balance: true,
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: [
          { isPinned: 'desc' },
          { lastMessageAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.chatThread.count({ where }),
    ]);

    return {
      threads,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ============================================
  // ✅ Get thread by ID
  // ============================================
  async getThreadById(threadId: string, userId: string) {
    const thread = await prisma.chatThread.findUnique({
      where: { id: threadId },
      include: {
        org: {
          select: { id: true, name: true, gstin: true },
        },
        counterpartyOrg: {
          select: { id: true, name: true, gstin: true },
        },
        account: {
          select: {
            id: true,
            ownerOrgId: true,
            counterpartyOrgId: true,
            balance: true,
          },
        },
      },
    });

    if (!thread) {
      throw new NotFoundError('Chat thread not found');
    }

    await this.verifyThreadAccess(thread, userId);
    return thread;
  }

  // ============================================
  // ✅ Get messages (with trip context)
  // ============================================
  async getMessages(threadId: string, userId: string, limit = 50, offset = 0) {
    await this.getThreadById(threadId, userId);

    const messages = await prisma.chatMessage.findMany({
      where: { threadId },
      include: {
        senderUser: {
          select: { id: true, name: true, phone: true },
        },
        attachments: {
          select: {
            id: true, url: true, fileName: true,
            mimeType: true, sizeBytes: true, type: true,
          },
        },
        replyTo: {
          select: {
            id: true, content: true, messageType: true,
            senderUser: { select: { id: true, name: true } },
            attachments: { select: { id: true, url: true, mimeType: true }, take: 1 },
          },
        },
        payment: {
          select: { id: true, amount: true, tag: true, mode: true, createdAt: true },
        },
        invoice: {
          select: { id: true, invoiceNumber: true, total: true, createdAt: true },
        },
        // ✅ NEW: Include trip context for trip-related messages
        trip: {
          select: {
            id: true, status: true, startPoint: true, endPoint: true,
            notes: true, createdAt: true,
            sourceOrg: { select: { id: true, name: true } },
            destinationOrg: { select: { id: true, name: true } },
            truck: { select: { id: true, number: true } },
            driver: {
              include: { user: { select: { id: true, name: true, phone: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await prisma.chatMessage.count({ where: { threadId } });

    return {
      messages: messages.reverse(),
      pagination: {
        total, limit, offset,
        hasMore: offset + limit < total,
      },
    };
  }

  // ============================================
  // ✅ Send message (supports trip context)
  // ============================================
  async sendMessage(threadId: string, data: SendMessageDto & { metadata?: any; tripId?: string }, userId: string) {
    const thread = await this.getThreadById(threadId, userId);

    // Idempotency check
    if (data.clientMessageId) {
      const existing = await prisma.chatMessage.findUnique({
        where: {
          threadId_clientMessageId: { threadId, clientMessageId: data.clientMessageId },
        },
        include: {
          senderUser: { select: { id: true, name: true, phone: true } },
          attachments: {
            select: { id: true, url: true, fileName: true, mimeType: true, sizeBytes: true, type: true },
          },
          replyTo: {
            select: {
              id: true, content: true, messageType: true,
              senderUser: { select: { id: true, name: true } },
              attachments: { select: { id: true, url: true, mimeType: true }, take: 1 },
            },
          },
          trip: { select: { id: true, status: true, startPoint: true, endPoint: true, notes: true } },
        },
      });
      if (existing) return existing;
    }

    // Verify attachments
    if (data.attachmentIds && data.attachmentIds.length > 0) {
      const attachments = await prisma.attachment.findMany({
        where: { id: { in: data.attachmentIds }, uploadedBy: userId, status: 'COMPLETED' },
      });
      if (attachments.length !== data.attachmentIds.length) {
        throw new ValidationError('Some attachments not found, not uploaded by you, or still pending');
      }
    }

    // Verify replyToId
    if (data.replyToId) {
      const replyMsg = await prisma.chatMessage.findFirst({
        where: { id: data.replyToId, threadId },
      });
      if (!replyMsg) throw new ValidationError('Reply message not found in this thread');
    }

    // Preview text
    let previewText = data.content?.substring(0, 100) || '';
    if (data.messageType === 'IMAGE') previewText = '📷 Photo';
    else if (data.messageType === 'PDF') previewText = '📄 Document';
    else if (data.messageType === 'FILE') previewText = '📎 File';
    else if (data.messageType === 'AUDIO') previewText = '🎤 Voice message';

    let messageId: string;

    try {
      const message = await prisma.$transaction(async (tx) => {
        const newMessage = await tx.chatMessage.create({
          data: {
            threadId,
            senderUserId: userId,
            content: data.content || null,
            messageType: data.messageType || 'TEXT',
            metadata: data.metadata || Prisma.JsonNull,
            replyToId: data.replyToId || null,
            clientMessageId: data.clientMessageId || null,
            tripId: data.tripId || null, // ✅ Trip context
          },
          include: {
            senderUser: { select: { id: true, name: true, phone: true } },
            replyTo: {
              select: {
                id: true, content: true, messageType: true,
                senderUser: { select: { id: true, name: true } },
              },
            },
          },
        });

        messageId = newMessage.id;

        // Link attachments
        if (data.attachmentIds && data.attachmentIds.length > 0) {
          await tx.attachment.updateMany({
            where: { id: { in: data.attachmentIds } },
            data: { messageId: newMessage.id },
          });
        }

        // Update thread metadata
        await tx.chatThread.update({
          where: { id: threadId },
          data: {
            updatedAt: new Date(),
            lastMessageAt: new Date(),
            lastMessageText: previewText,
            unreadCount: { increment: 1 },
          },
        });

        return newMessage;
      });

      messageId = message.id;
    } catch (error: any) {
      if (error.code === 'P2002' && data.clientMessageId) {
        const existing = await prisma.chatMessage.findUnique({
          where: {
            threadId_clientMessageId: { threadId, clientMessageId: data.clientMessageId },
          },
          include: {
            senderUser: { select: { id: true, name: true, phone: true } },
            attachments: {
              select: { id: true, url: true, fileName: true, mimeType: true, sizeBytes: true, type: true },
            },
            replyTo: {
              select: {
                id: true, content: true, messageType: true,
                senderUser: { select: { id: true, name: true } },
                attachments: { select: { id: true, url: true, mimeType: true }, take: 1 },
              },
            },
          },
        });
        if (existing) return existing;
      }
      throw error;
    }

    // Reload with attachments + trip context
    const fullMessage = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        senderUser: { select: { id: true, name: true, phone: true } },
        attachments: {
          select: { id: true, url: true, fileName: true, mimeType: true, sizeBytes: true, type: true },
        },
        replyTo: {
          select: {
            id: true, content: true, messageType: true,
            senderUser: { select: { id: true, name: true } },
            attachments: { select: { id: true, url: true, mimeType: true }, take: 1 },
          },
        },
        trip: {
          select: {
            id: true, status: true, startPoint: true, endPoint: true, notes: true, createdAt: true,
            sourceOrg: { select: { id: true, name: true } },
            destinationOrg: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Broadcast via WebSocket
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:message', fullMessage);
      } else {
        await redisPublisher.publish(
          `thread:${threadId}:message`,
          JSON.stringify(fullMessage)
        );
      }
    } catch (error) {
      console.error('Failed to broadcast message:', error);
    }

    return fullMessage;
  }

  // ============================================
  // ✅ Thread access verification (simplified — uses org pair directly)
  // ============================================
  private async verifyThreadAccess(thread: any, userId: string) {
    const orgIds = [thread.orgId, thread.counterpartyOrgId];

    const hasAccess = await prisma.orgMember.findFirst({
      where: { userId, orgId: { in: orgIds } },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to access this chat');
    }
  }

  // ============================================
  // ✅ Read Receipts
  // ============================================
  async markMessagesAsRead(threadId: string, userId: string, readUpToMsgId?: string) {
    await this.getThreadById(threadId, userId);

    let whereClause: any = {
      threadId,
      senderUserId: { not: userId },
      isRead: false,
    };

    if (readUpToMsgId) {
      const msg = await prisma.chatMessage.findUnique({ where: { id: readUpToMsgId } });
      if (msg) {
        whereClause.createdAt = { lte: msg.createdAt };
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.chatMessage.updateMany({
        where: whereClause,
        data: { isRead: true, readAt: new Date() },
      });

      const remainingUnread = await tx.chatMessage.count({
        where: { threadId, senderUserId: { not: userId }, isRead: false }
      });

      await tx.chatThread.update({
        where: { id: threadId },
        data: { unreadCount: remainingUnread },
      });

      return { count: updated.count, readUpTo: readUpToMsgId };
    });

    // Broadcast read receipt
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:read', {
          userId, readAt: new Date(), count: result.count, readUpTo: result.readUpTo
        });
      } else {
        await redisPublisher.publish(
          `thread:${threadId}:read`,
          JSON.stringify({ userId, readAt: new Date(), count: result.count, readUpTo: result.readUpTo })
        );
      }
    } catch (error) {
      console.error('Failed to broadcast read receipt:', error);
    }

    return result;
  }

  // ✅ Delivery Acknowledgment
  async markMessagesAsDelivered(threadId: string, userId: string, deliveredUpToMsgId?: string) {
    await this.getThreadById(threadId, userId);

    let whereClause: any = {
      threadId,
      senderUserId: { not: userId },
      isDelivered: false,
    };

    if (deliveredUpToMsgId) {
      const msg = await prisma.chatMessage.findUnique({ where: { id: deliveredUpToMsgId } });
      if (msg) {
        whereClause.createdAt = { lte: msg.createdAt };
      }
    }

    const updated = await prisma.chatMessage.updateMany({
      where: whereClause,
      data: { isDelivered: true, deliveredAt: new Date() },
    });

    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:delivered', {
          userId, deliveredAt: new Date(), count: updated.count, deliveredUpTo: deliveredUpToMsgId
        });
      } else {
        await redisPublisher.publish(
          `thread:${threadId}:delivered`,
          JSON.stringify({ userId, deliveredAt: new Date(), count: updated.count, deliveredUpTo: deliveredUpToMsgId })
        );
      }
    } catch (error) {
      console.error('Failed to broadcast delivery receipt:', error);
    }

    return { count: updated.count, deliveredUpTo: deliveredUpToMsgId };
  }

  // ✅ Pin/Unpin Thread
  async togglePinThread(threadId: string, userId: string, isPinned: boolean) {
    await this.getThreadById(threadId, userId);
    return prisma.chatThread.update({
      where: { id: threadId },
      data: { isPinned, pinnedAt: isPinned ? new Date() : null },
    });
  }

  // ✅ Archive/Unarchive Thread
  async toggleArchiveThread(threadId: string, userId: string, isArchived: boolean) {
    await this.getThreadById(threadId, userId);
    return prisma.chatThread.update({
      where: { id: threadId },
      data: { isArchived },
    });
  }

  // ✅ Get Unread Counts
  async getUnreadCounts(userId: string) {
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const orgIds = memberships.map(m => m.orgId);

    if (orgIds.length === 0) return [];

    return prisma.chatThread.findMany({
      where: {
        OR: [
          { orgId: { in: orgIds } },
          { counterpartyOrgId: { in: orgIds } },
        ],
        unreadCount: { gt: 0 },
      },
      select: { id: true, unreadCount: true },
    });
  }

  // ✅ Message Search
  async searchMessages(orgId: string, userId: string, query: string) {
    const membership = await prisma.orgMember.findFirst({
      where: { userId, orgId },
    });
    if (!membership) throw new ForbiddenError('Not a member of this organization');

    return prisma.chatMessage.findMany({
      where: {
        thread: {
          OR: [
            { orgId },
            { counterpartyOrgId: orgId },
          ],
        },
        OR: [
          { content: { contains: query, mode: 'insensitive' } },
          { payment: { reference: { contains: query } } },
          { invoice: { invoiceNumber: { contains: query } } },
        ],
      },
      include: {
        thread: {
          select: { id: true, title: true, orgId: true, counterpartyOrgId: true },
        },
        senderUser: { select: { id: true, name: true } },
        payment: { select: { id: true, amount: true, tag: true } },
        invoice: { select: { id: true, invoiceNumber: true, total: true } },
        trip: { select: { id: true, status: true, notes: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ============================================
  // ✅ TRIP CARD: Send trip as a contextual message card
  // Like Google Pay UPI bubbles inside a conversation
  // ============================================
  async sendTripCard(threadId: string, trip: any, userId: string) {
    return this.sendMessage(threadId, {
      content: `🚚 Trip: ${trip.sourceOrg.name} → ${trip.destinationOrg.name}`,
      messageType: 'TRIP_CARD',
      tripId: trip.id, // ✅ First-class trip reference on the message
      metadata: {
        tripId: trip.id,
        status: trip.status,
        truck: trip.truck?.number,
        driverMethod: trip.driver ? 'REGISTERED' : 'PENDING',
        driverName: trip.driver?.user?.name || 'Assigning...',
        driverPhone: trip.driver?.user?.phone || trip.pendingDriverPhone,
        startPoint: trip.startPoint,
        endPoint: trip.endPoint,
        notes: trip.notes,
      },
    }, userId);
  }

  // ✅ Payment Request (GPay Style)
  async sendPaymentRequest(threadId: string, amount: number, note: string, userId: string) {
    return this.sendMessage(threadId, {
      content: `Requested ₹${amount}`,
      messageType: 'PAYMENT_REQUEST',
      metadata: { amount, note, status: 'PENDING' },
    }, userId);
  }

  // ✅ Data Grid (Excel-like)
  async sendDataGrid(threadId: string, title: string, rows: any[], userId: string) {
    return this.sendMessage(threadId, {
      content: `SHARED DATA: ${title}`,
      messageType: 'DATA_GRID',
      metadata: { title, rows, columns: Object.keys(rows[0] || {}) },
    }, userId);
  }

  // ============================================
  // ✅ SYSTEM MESSAGE: Send to org-pair chat from a trip context
  // Used by trip.service.ts when trips are updated/loaded/etc.
  // Finds the org-pair chat between trip's source and dest orgs
  // ============================================
  async sendSystemMessage(
    tripId: string,
    content: string,
    metadata?: {
      type: string;
      [key: string]: any
    }
  ) {
    // Look up the trip to get the org pair
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        sourceOrgId: true,
        destinationOrgId: true,
        sourceOrg: { select: { id: true, name: true } },
        destinationOrg: { select: { id: true, name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Find or create the org-pair thread
    const { thread } = await this.findOrCreateOrgPairThread(
      trip.sourceOrgId,
      trip.destinationOrgId
    );

    // Create system message WITH trip context
    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.chatMessage.create({
        data: {
          threadId: thread.id,
          content,
          senderUserId: null, // System message
          messageType: 'SYSTEM_MESSAGE',
          metadata: metadata || Prisma.JsonNull,
          tripId, // ✅ Link message to trip
        },
        include: {
          senderUser: { select: { id: true, name: true, phone: true } },
          trip: {
            select: {
              id: true, status: true, startPoint: true, endPoint: true, notes: true,
              sourceOrg: { select: { id: true, name: true } },
              destinationOrg: { select: { id: true, name: true } },
            },
          },
        },
      });

      await tx.chatThread.update({
        where: { id: thread.id },
        data: {
          updatedAt: new Date(),
          lastMessageAt: new Date(),
          lastMessageText: content,
          unreadCount: { increment: 1 },
        },
      });

      return newMessage;
    });

    // Broadcast
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(thread.id, 'chat:message', message);
      } else {
        await redisPublisher.publish(
          `thread:${thread.id}:message`,
          JSON.stringify(message)
        );
      }
    } catch (error) {
      console.error('Failed to broadcast system message:', error);
    }

    return message;
  }

  // ============================================
  // ✅ ACCOUNT SYSTEM MESSAGE: Send to org-pair chat from an account context
  // Used by ledger.service.ts for payments, invoices, etc.
  // ============================================
  async sendAccountSystemMessage(
    accountId: string,
    content: string,
    messageType: string = 'SYSTEM_MESSAGE',
    metadata?: Record<string, any>,
    senderUserId?: string,
    paymentId?: string,
    invoiceId?: string
  ) {
    // Look up the account to get the org pair
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    // Find or create the org-pair thread, linking the account
    const { thread } = await this.findOrCreateOrgPairThread(
      account.ownerOrgId,
      account.counterpartyOrgId,
      { accountId }
    );

    // Create the message
    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.chatMessage.create({
        data: {
          threadId: thread.id,
          senderUserId: senderUserId || null,
          content,
          messageType: messageType as any,
          metadata: metadata || Prisma.JsonNull,
          paymentId: paymentId || null,
          invoiceId: invoiceId || null,
        },
        include: {
          senderUser: { select: { id: true, name: true, phone: true } },
        },
      });

      await tx.chatThread.update({
        where: { id: thread.id },
        data: {
          updatedAt: new Date(),
          lastMessageAt: new Date(),
          lastMessageText: content.substring(0, 100),
          unreadCount: { increment: 1 },
        },
      });

      return newMessage;
    });

    // Broadcast
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(thread.id, 'chat:message', message);
      } else {
        await redisPublisher.publish(
          `thread:${thread.id}:message`,
          JSON.stringify(message)
        );
      }
    } catch (error) {
      console.error('Failed to broadcast account system message:', error);
    }

    return message;
  }

  // ✅ GPay-style: Payment Update Card
  async sendPaymentUpdateCard(
    accountId: string,
    payment: {
      id: string;
      amount: number | bigint;
      status: string;
      mode?: string | null;
      tag?: string | null;
      utrNumber?: string | null;
      remarks?: string | null;
    },
    action: 'REQUESTED' | 'MARKED_PAID' | 'CONFIRMED' | 'DISPUTED',
    senderUserId?: string,
    disputeReason?: string
  ) {
    const amount = Number(payment.amount);
    const amountFormatted = `₹${amount.toLocaleString('en-IN')}`;

    const statusEmoji: Record<string, string> = {
      REQUESTED: '🔔',
      MARKED_PAID: '💸',
      CONFIRMED: '✅',
      DISPUTED: '⚠️',
    };

    const statusText: Record<string, string> = {
      REQUESTED: `${amountFormatted} payment requested`,
      MARKED_PAID: `${amountFormatted} marked as paid${payment.mode ? ` via ${payment.mode}` : ''}`,
      CONFIRMED: `${amountFormatted} payment confirmed`,
      DISPUTED: `${amountFormatted} payment disputed${disputeReason ? `: ${disputeReason}` : ''}`,
    };

    return this.sendAccountSystemMessage(
      accountId,
      `${statusEmoji[action]} ${statusText[action]}`,
      'PAYMENT_REQUEST',
      {
        paymentId: payment.id,
        amount,
        status: payment.status,
        action,
        mode: payment.mode,
        tag: payment.tag,
        utrNumber: payment.utrNumber,
        remarks: payment.remarks,
        disputeReason,
      },
      senderUserId,
      payment.id
    );
  }

  // ✅ Invoice Card
  async sendInvoiceCard(
    accountId: string,
    invoice: {
      id: string;
      invoiceNumber: string;
      total: number | bigint;
      description?: string | null;
      dueDate?: Date | null;
    },
    senderUserId: string
  ) {
    const total = Number(invoice.total);
    return this.sendAccountSystemMessage(
      accountId,
      `🧾 Invoice #${invoice.invoiceNumber} — ₹${total.toLocaleString('en-IN')}`,
      'INVOICE_CARD',
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        total,
        description: invoice.description,
        dueDate: invoice.dueDate,
        status: 'OPEN',
      },
      senderUserId,
      undefined,
      invoice.id
    );
  }
}
