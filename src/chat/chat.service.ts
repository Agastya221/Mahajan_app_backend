import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { CreateThreadDto, SendMessageDto } from './chat.dto';
import { redisPublisher } from '../config/redis';
import { Prisma } from '@prisma/client';

export class ChatService {
  async createOrGetThread(data: CreateThreadDto, userId: string) {
    if (data.accountId) {
      return this.createOrGetAccountThread(data.accountId, userId);
    } else if (data.tripId) {
      return this.createOrGetTripThread(data.tripId, userId);
    }

    throw new ValidationError('Either accountId or tripId must be provided');
  }

  private async createOrGetAccountThread(accountId: string, userId: string) {
    // Verify account exists and user has access
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [account.ownerOrgId, account.counterpartyOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to access this account');
    }

    const threadInclude = {
      account: {
        include: {
          ownerOrg: {
            select: { id: true, name: true, gstin: true },
          },
          counterpartyOrg: {
            select: { id: true, name: true, gstin: true },
          },
        },
      },
    };

    // Check if thread already exists
    const existing = await prisma.chatThread.findUnique({
      where: { accountId },
      include: threadInclude,
    });

    if (existing) {
      return { thread: existing, isNew: false };
    }

    // Create new thread (handle race condition with try/catch outside transaction)
    try {
      const thread = await prisma.chatThread.create({
        data: {
          orgId: account.ownerOrgId,
          accountId,
        },
        include: threadInclude,
      });
      return { thread, isNew: true };
    } catch (error: any) {
      // If unique constraint violation (race condition), fetch existing
      if (error.code === 'P2002') {
        const raceThread = await prisma.chatThread.findUnique({
          where: { accountId },
          include: threadInclude,
        });
        if (!raceThread) {
          throw new Error('Thread creation failed and existing thread not found');
        }
        return { thread: raceThread, isNew: false };
      }
      throw error;
    }
  }

  private async createOrGetTripThread(tripId: string, userId: string) {
    // Verify trip exists and user has access
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to access this trip');
    }

    const tripThreadInclude = {
      trip: {
        include: {
          sourceOrg: {
            select: { id: true, name: true },
          },
          destinationOrg: {
            select: { id: true, name: true },
          },
        },
      },
    };

    // Check if thread already exists
    const existing = await prisma.chatThread.findUnique({
      where: { tripId },
      include: tripThreadInclude,
    });

    if (existing) {
      return { thread: existing, isNew: false };
    }

    // Create new thread (handle race condition with try/catch outside transaction)
    try {
      const thread = await prisma.chatThread.create({
        data: {
          orgId: trip.sourceOrgId,
          tripId,
        },
        include: tripThreadInclude,
      });
      return { thread, isNew: true };
    } catch (error: any) {
      if (error.code === 'P2002') {
        const raceThread = await prisma.chatThread.findUnique({
          where: { tripId },
          include: tripThreadInclude,
        });
        if (!raceThread) {
          throw new Error('Thread creation failed and existing thread not found');
        }
        return { thread: raceThread, isNew: false };
      }
      throw error;
    }
  }

  async getThreads(userId: string, filters?: { accountId?: string; tripId?: string; page?: number; limit?: number }) {
    // Get all orgs user is member of
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });

    const orgIds = memberships.map(m => m.orgId);

    if (orgIds.length === 0) {
      return { threads: [] as any[], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }

    // ✅ TYPE SAFETY FIX: Use proper Prisma types instead of any
    const where: Prisma.ChatThreadWhereInput = {
      OR: [],
    };

    if (filters?.accountId) {
      where.accountId = filters.accountId;
    } else if (filters?.tripId) {
      where.tripId = filters.tripId;
    } else {
      // Get threads for accounts where user's org is involved
      where.OR = [
        {
          account: {
            OR: [
              { ownerOrgId: { in: orgIds } },
              { counterpartyOrgId: { in: orgIds } },
            ],
          },
        },
        // Get threads for trips where user's org is involved
        {
          trip: {
            OR: [
              { sourceOrgId: { in: orgIds } },
              { destinationOrgId: { in: orgIds } },
            ],
          },
        },
      ];
    }

    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);

    const [threads, total] = await Promise.all([
      prisma.chatThread.findMany({
        where,
        include: {
          account: {
            include: {
              ownerOrg: {
                select: { id: true, name: true, gstin: true },
              },
              counterpartyOrg: {
                select: { id: true, name: true, gstin: true },
              },
            },
          },
          trip: {
            include: {
              sourceOrg: {
                select: { id: true, name: true },
              },
              destinationOrg: {
                select: { id: true, name: true },
              },
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

  async getThreadById(threadId: string, userId: string) {
    const thread = await prisma.chatThread.findUnique({
      where: { id: threadId },
      include: {
        account: {
          include: {
            ownerOrg: {
              select: { id: true, name: true, gstin: true },
            },
            counterpartyOrg: {
              select: { id: true, name: true, gstin: true },
            },
          },
        },
        trip: {
          include: {
            sourceOrg: {
              select: { id: true, name: true },
            },
            destinationOrg: {
              select: { id: true, name: true },
            },
            driver: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!thread) {
      throw new NotFoundError('Chat thread not found');
    }

    // Verify user has access
    await this.verifyThreadAccess(thread, userId);

    return thread;
  }

  async getMessages(threadId: string, userId: string, limit = 50, offset = 0) {
    const thread = await this.getThreadById(threadId, userId);

    const messages = await prisma.chatMessage.findMany({
      where: { threadId },
      include: {
        senderUser: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        attachments: {
          select: {
            id: true,
            url: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            type: true,
          },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            messageType: true,
            senderUser: { select: { id: true, name: true } },
            attachments: { select: { id: true, url: true, mimeType: true }, take: 1 },
          },
        },
        payment: {
          select: {
            id: true,
            amount: true,
            tag: true,
            mode: true,
            createdAt: true,
          },
        },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    const total = await prisma.chatMessage.count({
      where: { threadId },
    });

    return {
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  async sendMessage(threadId: string, data: SendMessageDto & { metadata?: any }, userId: string) {
    const thread = await this.getThreadById(threadId, userId);

    // Verify attachments exist and belong to user
    if (data.attachmentIds && data.attachmentIds.length > 0) {
      const attachments = await prisma.attachment.findMany({
        where: {
          id: { in: data.attachmentIds },
          uploadedBy: userId,
          status: 'COMPLETED',
        },
      });

      if (attachments.length !== data.attachmentIds.length) {
        throw new ValidationError('Some attachments not found, not uploaded by you, or still pending');
      }
    }

    // Verify replyToId belongs to this thread
    if (data.replyToId) {
      const replyMsg = await prisma.chatMessage.findFirst({
        where: { id: data.replyToId, threadId },
      });
      if (!replyMsg) throw new ValidationError('Reply message not found in this thread');
    }

    // Determine preview text for thread
    let previewText = data.content?.substring(0, 100) || '';
    if (data.messageType === 'IMAGE') previewText = '📷 Photo';
    else if (data.messageType === 'PDF') previewText = '📄 Document';
    else if (data.messageType === 'FILE') previewText = '📎 File';

    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.chatMessage.create({
        data: {
          threadId,
          senderUserId: userId,
          content: data.content || null,
          messageType: data.messageType || 'TEXT',
          metadata: data.metadata || Prisma.JsonNull,
          replyToId: data.replyToId || null,
        },
        include: {
          senderUser: {
            select: { id: true, name: true, phone: true },
          },
          replyTo: {
            select: {
              id: true,
              content: true,
              messageType: true,
              senderUser: { select: { id: true, name: true } },
            },
          },
        },
      });

      // Link attachments to message
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

    // Reload with attachments
    const fullMessage = await prisma.chatMessage.findUnique({
      where: { id: message.id },
      include: {
        senderUser: { select: { id: true, name: true, phone: true } },
        attachments: {
          select: {
            id: true,
            url: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            type: true,
          },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            messageType: true,
            senderUser: { select: { id: true, name: true } },
            attachments: { select: { id: true, url: true, mimeType: true }, take: 1 },
          },
        },
      },
    });

    // Broadcast via Redis WebSocket
    try {
      await redisPublisher.publish(
        `thread:${threadId}:message`,
        JSON.stringify(fullMessage)
      );
    } catch (error) {
      console.error('Failed to broadcast message:', error);
    }

    return fullMessage;
  }

  private async verifyThreadAccess(thread: any, userId: string) {
    let orgIds: string[] = [];

    if (thread.account) {
      orgIds = [thread.account.ownerOrgId, thread.account.counterpartyOrgId];
    } else if (thread.trip) {
      orgIds = [thread.trip.sourceOrgId, thread.trip.destinationOrgId];
    }

    if (orgIds.length === 0) {
      throw new ForbiddenError('Invalid thread');
    }

    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: orgIds },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to access this chat');
    }
  }

  // ✅ WhatsApp-like Feature: Read Receipts
  async markMessagesAsRead(threadId: string, userId: string) {
    const thread = await this.getThreadById(threadId, userId);

    const result = await prisma.$transaction(async (tx) => {
      // Mark all unread messages as read
      const updated = await tx.chatMessage.updateMany({
        where: {
          threadId,
          senderUserId: { not: userId }, // Don't mark own messages
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      // Reset unread count for this thread
      await tx.chatThread.update({
        where: { id: threadId },
        data: { unreadCount: 0 },
      });

      return { count: updated.count };
    });

    // Broadcast read receipt via WebSocket
    try {
      await redisPublisher.publish(
        `thread:${threadId}:read`,
        JSON.stringify({
          userId,
          readAt: new Date(),
          count: result.count,
        })
      );
    } catch (error) {
      console.error('Failed to broadcast read receipt:', error);
    }

    return result;
  }

  // ✅ WhatsApp-like Feature: Delivery Acknowledgment (Single Tick)
  async markMessagesAsDelivered(threadId: string, userId: string) {
    const thread = await this.getThreadById(threadId, userId);

    // Mark all messages from OTHER senders as delivered
    const result = await prisma.chatMessage.updateMany({
      where: {
        threadId,
        senderUserId: { not: userId },
        isDelivered: false,
      },
      data: {
        isDelivered: true,
        deliveredAt: new Date(),
      },
    });

    // Broadcast delivery receipt via Redis for WebSocket
    try {
      await redisPublisher.publish(
        `thread:${threadId}:delivered`,
        JSON.stringify({
          userId,
          deliveredAt: new Date(),
          count: result.count,
        })
      );
    } catch (error) {
      console.error('Failed to broadcast delivery receipt:', error);
    }

    return { count: result.count };
  }

  // ✅ WhatsApp-like Feature: Pin/Unpin Thread
  async togglePinThread(threadId: string, userId: string, isPinned: boolean) {
    const thread = await this.getThreadById(threadId, userId);

    const updated = await prisma.chatThread.update({
      where: { id: threadId },
      data: {
        isPinned,
        pinnedAt: isPinned ? new Date() : null,
      },
    });

    return updated;
  }

  // ✅ WhatsApp-like Feature: Archive/Unarchive Thread
  async toggleArchiveThread(threadId: string, userId: string, isArchived: boolean) {
    const thread = await this.getThreadById(threadId, userId);

    const updated = await prisma.chatThread.update({
      where: { id: threadId },
      data: { isArchived },
    });

    return updated;
  }

  // ✅ Enhanced: Get Unread Count per Thread
  async getUnreadCounts(userId: string) {
    // Get all orgs user is member of
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });

    const orgIds = memberships.map((m) => m.orgId);

    if (orgIds.length === 0) {
      return [];
    }

    // Get unread counts for all threads user has access to
    const threads = await prisma.chatThread.findMany({
      where: {
        OR: [
          {
            account: {
              OR: [
                { ownerOrgId: { in: orgIds } },
                { counterpartyOrgId: { in: orgIds } },
              ],
            },
          },
          {
            trip: {
              OR: [
                { sourceOrgId: { in: orgIds } },
                { destinationOrgId: { in: orgIds } },
              ],
            },
          },
        ],
        unreadCount: { gt: 0 },
      },
      select: {
        id: true,
        unreadCount: true,
      },
    });

    return threads;
  }

  // ✅ Enhanced: Message Search
  async searchMessages(orgId: string, userId: string, query: string) {
    // Verify user is member of org
    const membership = await prisma.orgMember.findFirst({
      where: { userId, orgId },
    });

    if (!membership) {
      throw new ForbiddenError('Not a member of this organization');
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        thread: {
          OR: [
            {
              account: {
                OR: [{ ownerOrgId: orgId }, { counterpartyOrgId: orgId }],
              },
            },
            {
              trip: {
                OR: [{ sourceOrgId: orgId }, { destinationOrgId: orgId }],
              },
            },
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
          select: {
            id: true,
            title: true,
            accountId: true,
            tripId: true,
          },
        },
        senderUser: {
          select: {
            id: true,
            name: true,
          },
        },
        payment: {
          select: {
            id: true,
            amount: true,
            tag: true,
          },
        },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    return messages;
  }

  // ✅ New Action: Send Trip Card (Interactive Widget)
  async sendTripCard(threadId: string, trip: any, userId: string) {
    return this.sendMessage(threadId, {
      content: `Trip created: ${trip.sourceOrg.name} → ${trip.destinationOrg.name}`,
      messageType: 'TRIP_CARD',
      metadata: {
        tripId: trip.id,
        status: trip.status,
        truck: trip.truck?.number,
        driverMethod: trip.driver ? 'REGISTERED' : 'PENDING',
        driverName: trip.driver?.user?.name || 'Assigning...',
        driverPhone: trip.driver?.user?.phone || trip.pendingDriverPhone,
        items: [], // Will be populated when load card is created
      },
    }, userId);
  }

  // ✅ New Action: Send Payment Request (GPay Style)
  async sendPaymentRequest(threadId: string, amount: number, note: string, userId: string) {
    return this.sendMessage(threadId, {
      content: `Requested ₹${amount}`,
      messageType: 'PAYMENT_REQUEST',
      metadata: {
        amount,
        note,
        status: 'PENDING',
      },
    }, userId);
  }

  // ✅ New Action: Send Excel-like Data Grid
  async sendDataGrid(threadId: string, title: string, rows: any[], userId: string) {
    return this.sendMessage(threadId, {
      content: `SHARED DATA: ${title}`,
      messageType: 'DATA_GRID',
      metadata: {
        title,
        rows, // Array of objects
        columns: Object.keys(rows[0] || {}),
      },
    }, userId);
  }

  // ✅ System-generated messages (for notifications, shortage alerts, payment requests, etc.)
  async sendSystemMessage(
    tripId: string,
    content: string,
    metadata?: {
      type: string;
      [key: string]: any
    }
  ) {
    // Get or create thread for this trip
    let thread = await prisma.chatThread.findUnique({
      where: { tripId },
      include: {
        trip: {
          include: {
            sourceOrg: {
              select: { id: true, name: true },
            },
            destinationOrg: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    // Create thread if it doesn't exist
    if (!thread) {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        include: {
          sourceOrg: {
            select: { id: true, name: true },
          },
          destinationOrg: {
            select: { id: true, name: true },
          },
        },
      });

      if (!trip) {
        throw new NotFoundError('Trip not found');
      }

      thread = await prisma.chatThread.create({
        data: {
          orgId: trip.sourceOrgId,
          tripId,
        },
        include: {
          trip: {
            include: {
              sourceOrg: {
                select: { id: true, name: true },
              },
              destinationOrg: {
                select: { id: true, name: true },
              },
            },
          },
        },
      });
    }

    // Create system message (no sender)
    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.chatMessage.create({
        data: {
          threadId: thread!.id,
          content,
          senderUserId: null, // System message has no sender
          messageType: 'SYSTEM_MESSAGE',
          metadata: metadata || Prisma.JsonNull,
        },
        include: {
          senderUser: {
            select: { id: true, name: true, phone: true },
          },
        },
      });

      // Update thread
      await tx.chatThread.update({
        where: { id: thread!.id },
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
      await redisPublisher.publish(
        `thread:${thread!.id}:message`,
        JSON.stringify(message)
      );
    } catch (error) {
      console.error('Failed to broadcast system message:', error);
    }

    return message;
  }

  // ✅ System message for ACCOUNT-based threads (Ledger, Payments, Invoices)
  async sendAccountSystemMessage(
    accountId: string,
    content: string,
    messageType: string = 'SYSTEM_MESSAGE',
    metadata?: Record<string, any>,
    senderUserId?: string,
    paymentId?: string,
    invoiceId?: string
  ) {
    // Find or create thread for this account
    let thread = await prisma.chatThread.findUnique({
      where: { accountId },
    });

    if (!thread) {
      const account = await prisma.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new NotFoundError('Account not found');
      }

      thread = await prisma.chatThread.create({
        data: {
          orgId: account.ownerOrgId,
          accountId,
        },
      });
    }

    // Create the message
    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.chatMessage.create({
        data: {
          threadId: thread!.id,
          senderUserId: senderUserId || null,
          content,
          messageType: messageType as any,
          metadata: metadata || Prisma.JsonNull,
          paymentId: paymentId || null,
          invoiceId: invoiceId || null,
        },
        include: {
          senderUser: {
            select: { id: true, name: true, phone: true },
          },
        },
      });

      // Update thread
      await tx.chatThread.update({
        where: { id: thread!.id },
        data: {
          updatedAt: new Date(),
          lastMessageAt: new Date(),
          lastMessageText: content.substring(0, 100),
          unreadCount: { increment: 1 },
        },
      });

      return newMessage;
    });

    // Broadcast via Redis
    try {
      await redisPublisher.publish(
        `thread:${thread!.id}:message`,
        JSON.stringify(message)
      );
    } catch (error) {
      console.error('Failed to broadcast account system message:', error);
    }

    return message;
  }

  // ✅ GPay-style: Send Payment Update Card to account chat
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

  // ✅ Invoice Card: post invoice to account chat
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
