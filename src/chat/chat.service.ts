import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';
import { CreateThreadDto, SendMessageDto, EditMessageDto, DeleteMessageDto } from './chat.dto';
import { redisPublisher } from '../config/redis';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { notificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/notification.types';

// ✅ Max time (in minutes) allowed for editing/deleting-for-everyone
const EDIT_WINDOW_MINUTES = 15;
const DELETE_FOR_EVERYONE_WINDOW_MINUTES = 60;

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
  // ✅ Start Chat by Phone (Add Mahajan Flow)
  // ============================================
  async startChatByPhone(phone: string, userId: string) {
    // 1. Get user's org
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const userOrgIds = memberships.map((m) => m.orgId);
    if (userOrgIds.length === 0) {
      throw new ForbiddenError('User is not a member of any organization');
    }
    const myOrgId = userOrgIds[0];

    // Normalize phone format if needed
    let normalizedPhone = phone.trim();
    if (normalizedPhone.length === 10 && !normalizedPhone.startsWith('+91')) {
      normalizedPhone = `+91${normalizedPhone}`;
    }

    // 2. Find org by phone
    const { OrgService } = await import('../org/org.service'); // Lazy import to avoid circular dependency
    const orgService = new OrgService();
    let targetOrg = await orgService.searchOrgsByPhone(normalizedPhone);

    if (targetOrg) {
      if (userOrgIds.includes(targetOrg.id)) {
        throw new ValidationError('Cannot start a chat with your own organization');
      }

      // CASE A & B: Real Org or Placeholder Org exists 
      // Proceed and create/get the thread
      const result = await this.findOrCreateOrgPairThread(myOrgId, targetOrg.id);
      return { ...result, inviteRequired: false };
    }

    // CASE C: No Org Exists -> Create Placeholder Org & Invite
    // 1. Create Placeholder Org
    const placeholderOrgName = `Pending (${normalizedPhone})`;
    const placeholderOrg = await prisma.org.create({
      data: {
        name: placeholderOrgName,
        phone: normalizedPhone,
      },
    });

    // 2. Create Invite Record
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.mahajanInvite.upsert({
      where: {
        invitedByOrgId_invitedPhone: {
          invitedByOrgId: myOrgId,
          invitedPhone: normalizedPhone
        }
      },
      update: {
        inviteToken: token, // Refresh token just in case
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Refresh expiry
      },
      create: {
        invitedByOrgId: myOrgId,
        invitedPhone: normalizedPhone,
        inviteToken: token,
        inviteeOrgId: placeholderOrg.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      }
    });

    // Send SMS (Mock for now)
    logger.info(`Mock SMS Sent to ${normalizedPhone}: You have been invited by ${myOrgId}. Join using token ${token}`);

    // 3. Create Chat Thread with Placeholder
    const threadResult = await this.findOrCreateOrgPairThread(myOrgId, placeholderOrg.id);

    return { ...threadResult, inviteRequired: true };
  }

  // ============================================
  // ✅ Get all threads for user (with per-user unread counts)
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
            where: { isDeletedForEveryone: false },
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

    // ✅ Compute unread count per-user (only messages from OTHER users, NOT read)
    // Excludes: your own messages, system messages (null sender), deleted messages
    const threadsWithMeta = await Promise.all(
      threads.map(async (thread) => {
        // Unread count
        const unreadCount = await prisma.chatMessage.count({
          where: {
            threadId: thread.id,
            senderUserId: { not: null },       // Exclude system messages
            NOT: { senderUserId: userId },      // Exclude MY messages
            isRead: false,
            isDeletedForEveryone: false,
            deletions: { none: { userId } },
          },
        });

        // ✅ Counterparty account status — so frontend can show "Account Suspended" banner
        const counterpartyOrgId = orgIds.includes(thread.orgId)
          ? thread.counterpartyOrgId
          : thread.orgId;

        const counterpartyStatus = await this.getOrgAccountStatus(counterpartyOrgId);

        return { ...thread, unreadCount, counterpartyStatus };
      })
    );

    return {
      threads: threadsWithMeta,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ============================================
  // ✅ Get thread by ID (includes counterparty account status)
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

    // ✅ Determine which org is "theirs" (counterparty from user's perspective)
    const userMemberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const myOrgIds = userMemberships.map(m => m.orgId);
    const counterpartyOrgId = myOrgIds.includes(thread.orgId)
      ? thread.counterpartyOrgId
      : thread.orgId;

    const counterpartyStatus = await this.getOrgAccountStatus(counterpartyOrgId);

    // ✅ FEATURE 3: Compute block status
    let blockStatus: 'BLOCKED_BY_YOU' | 'BLOCKED_BY_OTHER' | null = null;
    if (thread.blockedByOrgId) {
      const userOrgId = myOrgIds.includes(thread.orgId) ? thread.orgId : thread.counterpartyOrgId;
      blockStatus = thread.blockedByOrgId === userOrgId ? 'BLOCKED_BY_YOU' : 'BLOCKED_BY_OTHER';
    }

    return { ...thread, counterpartyStatus, blockStatus };
  }

  // ============================================
  // ✅ Helper: Get the "worst" account status across an org's members
  // BANNED > SUSPENDED > ACTIVE
  // ============================================
  private async getOrgAccountStatus(orgId: string): Promise<{
    status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
    message: string | null;
  }> {
    const members = await prisma.orgMember.findMany({
      where: { orgId },
      include: {
        user: {
          select: { status: true, suspendedAt: true, bannedAt: true, statusReason: true },
        },
      },
    });

    if (members.length === 0) {
      return { status: 'ACTIVE', message: null };
    }

    // Check if ALL members are banned
    const allBanned = members.every(m => m.user.status === 'BANNED');
    if (allBanned) {
      const reason = members[0]?.user.statusReason;
      return {
        status: 'BANNED',
        message: reason || 'This account has been banned',
      };
    }

    // Check if ALL members are suspended or banned (no one active)
    const allInactive = members.every(m => m.user.status !== 'ACTIVE');
    if (allInactive) {
      const suspendedMember = members.find(m => m.user.status === 'SUSPENDED');
      const reason = suspendedMember?.user.statusReason;
      return {
        status: 'SUSPENDED',
        message: reason || 'This account has been suspended',
      };
    }

    return { status: 'ACTIVE', message: null };
  }

  // ============================================
  // ✅ Get messages (with trip context, filtered for deletions)
  // ============================================
  async getMessages(threadId: string, userId: string, limit = 50, offset = 0) {
    await this.getThreadById(threadId, userId);

    // ✅ Filter: exclude deleted-for-everyone AND deleted-for-me messages
    const whereClause: Prisma.ChatMessageWhereInput = {
      threadId,
      isDeletedForEveryone: false,
      deletions: { none: { userId } },
    };

    const messages = await prisma.chatMessage.findMany({
      where: whereClause,
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
        // ✅ Include trip context for trip-related messages
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

    const total = await prisma.chatMessage.count({ where: whereClause });

    // ✅ AUTO-MARK AS READ: When user opens a chat and fetches messages,
    // mark all unread messages from OTHER users as read (like WhatsApp).
    // This runs in the background — don't block the response.
    const markReadPromise = prisma.chatMessage.updateMany({
      where: {
        threadId,
        senderUserId: { not: null },
        NOT: { senderUserId: userId },
        isRead: false,
        isDeletedForEveryone: false,
      },
      data: { isRead: true, readAt: new Date() },
    });

    markReadPromise
      .then((result) => {
        if (result.count > 0) {
          // Broadcast read receipt so sender sees blue ticks
          try {
            if ((global as any).socketGateway) {
              (global as any).socketGateway.broadcastToChat(threadId, 'chat:read', {
                userId, readAt: new Date(), count: result.count,
              });
            }
          } catch (err) {
            console.error('Failed to broadcast auto-read receipt:', err);
          }
        }
      })
      .catch((err) => console.error('Failed to auto-mark messages as read:', err));

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

    // ✅ FEATURE 3: Block check — nobody can send in a blocked conversation
    if (thread.blockedByOrgId) {
      throw new ForbiddenError('Cannot send messages in a blocked conversation');
    }

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
    else if (data.messageType === 'LOCATION') previewText = '📍 Location';

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
            tripId: data.tripId || null,
            locationLat: data.locationLat || null,
            locationLng: data.locationLng || null,
            // NOTE: isRead stays false (default) — it means "receiver hasn't read it yet"
            // The SENDER's unread count excludes their own messages via senderUserId filter,
            // NOT via isRead. isRead is only flipped when the RECEIVER calls markMessagesAsRead.
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

        // Update thread metadata (unreadCount removed — computed dynamically per-user)
        await tx.chatThread.update({
          where: { id: threadId },
          data: {
            updatedAt: new Date(),
            lastMessageAt: new Date(),
            lastMessageText: previewText,
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

    // ✅ Push notification: Notify the other org when a chat message is sent
    const notifiableTypes = ['TEXT', 'IMAGE', 'PDF', 'FILE', 'AUDIO', 'PAYMENT_REQUEST', 'INVOICE_CARD'];
    if (notifiableTypes.includes(data.messageType || 'TEXT')) {
      const senderMembership = await prisma.orgMember.findFirst({
        where: { userId, orgId: { in: [thread.orgId, thread.counterpartyOrgId] } },
        select: { orgId: true },
      });
      if (senderMembership) {
        const recipientOrgId = senderMembership.orgId === thread.orgId
          ? thread.counterpartyOrgId
          : thread.orgId;

        const senderName = fullMessage?.senderUser?.name || 'Someone';
        let notifBody = data.content?.substring(0, 100) || '';
        if (data.messageType === 'IMAGE') notifBody = '📷 Photo';
        else if (data.messageType === 'PDF') notifBody = '📄 Document';
        else if (data.messageType === 'FILE') notifBody = '📎 File';
        else if (data.messageType === 'AUDIO') notifBody = '🎤 Voice message';
        else if (data.messageType === 'PAYMENT_REQUEST') notifBody = '💰 Payment request';
        else if (data.messageType === 'INVOICE_CARD') notifBody = '🧾 Invoice';

        notificationService.enqueueNotification({
          type: NotificationType.CHAT_MESSAGE,
          recipientOrgId,
          title: senderName,
          body: notifBody,
          data: { threadId, messageId: fullMessage?.id || '', messageType: data.messageType || 'TEXT' },
        }).catch(err => logger.error('Failed to queue chat message notification', err));
      }
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
  // ✅ Read Receipts (no more unreadCount on thread — computed dynamically)
  // ============================================
  async markMessagesAsRead(threadId: string, userId: string, readUpToMsgId?: string) {
    await this.getThreadById(threadId, userId);

    let whereClause: any = {
      threadId,
      senderUserId: { not: null },      // Skip system messages (already isRead:true)
      NOT: { senderUserId: userId },     // Skip my own messages (already isRead:true)
      isRead: false,
      isDeletedForEveryone: false,
    };

    if (readUpToMsgId) {
      const msg = await prisma.chatMessage.findUnique({ where: { id: readUpToMsgId } });
      if (msg) {
        whereClause.createdAt = { lte: msg.createdAt };
      }
    }

    const updated = await prisma.chatMessage.updateMany({
      where: whereClause,
      data: { isRead: true, readAt: new Date() },
    });

    const result = { count: updated.count, readUpTo: readUpToMsgId };

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

  // ============================================
  // ✅ EDIT MESSAGE (WhatsApp-style: sender only, within time limit)
  // ============================================
  async editMessage(threadId: string, messageId: string, newContent: string, userId: string) {
    // 1. Verify thread access
    await this.getThreadById(threadId, userId);

    // 2. Find the message
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) throw new NotFoundError('Message not found');
    if (message.threadId !== threadId) throw new ValidationError('Message does not belong to this thread');
    if (message.senderUserId !== userId) throw new ForbiddenError('You can only edit your own messages');
    if (message.messageType !== 'TEXT') throw new ValidationError('Only TEXT messages can be edited');
    if (message.isDeletedForEveryone) throw new ValidationError('Cannot edit a deleted message');

    // 3. Check time window (15 minutes)
    const minutesSince = (Date.now() - message.createdAt.getTime()) / (1000 * 60);
    if (minutesSince > EDIT_WINDOW_MINUTES) {
      throw new ValidationError(`Messages can only be edited within ${EDIT_WINDOW_MINUTES} minutes of sending`);
    }

    // 4. Update the message
    const updatedMessage = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content: newContent,
        isEdited: true,
        editedAt: new Date(),
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
          },
        },
      },
    });

    // 5. Update thread's lastMessageText if this was the latest message
    const latestMsg = await prisma.chatMessage.findFirst({
      where: { threadId, isDeletedForEveryone: false },
      orderBy: { createdAt: 'desc' },
    });
    if (latestMsg?.id === messageId) {
      await prisma.chatThread.update({
        where: { id: threadId },
        data: { lastMessageText: newContent.substring(0, 100) },
      });
    }

    // 6. Broadcast via WebSocket
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:edit', updatedMessage);
      } else {
        await redisPublisher.publish(
          `thread:${threadId}:edit`,
          JSON.stringify(updatedMessage)
        );
      }
    } catch (error) {
      console.error('Failed to broadcast edit:', error);
    }

    return updatedMessage;
  }

  // ============================================
  // ✅ DELETE MESSAGE (WhatsApp-style: "Delete for me" + "Delete for everyone")
  // ============================================
  async deleteMessage(threadId: string, messageId: string, deleteFor: 'me' | 'everyone', userId: string) {
    // 1. Verify thread access
    await this.getThreadById(threadId, userId);

    // 2. Find the message
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) throw new NotFoundError('Message not found');
    if (message.threadId !== threadId) throw new ValidationError('Message does not belong to this thread');

    if (deleteFor === 'everyone') {
      // Only sender can delete for everyone
      if (message.senderUserId !== userId) {
        throw new ForbiddenError('Only the sender can delete a message for everyone');
      }

      // Check time window (60 minutes for delete-for-everyone)
      const minutesSince = (Date.now() - message.createdAt.getTime()) / (1000 * 60);
      if (minutesSince > DELETE_FOR_EVERYONE_WINDOW_MINUTES) {
        throw new ValidationError(`Messages can only be deleted for everyone within ${DELETE_FOR_EVERYONE_WINDOW_MINUTES} minutes`);
      }

      // Already deleted check
      if (message.isDeletedForEveryone) {
        throw new ValidationError('Message is already deleted');
      }

      // Soft delete for everyone
      await prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          isDeletedForEveryone: true,
          deletedAt: new Date(),
          deletedByUserId: userId,
          content: null, // Clear content 
          metadata: Prisma.JsonNull,
          locationLat: null,
          locationLng: null,
        },
      });

      // Update thread's lastMessageText if this was the latest
      const latestMsg = await prisma.chatMessage.findFirst({
        where: { threadId, isDeletedForEveryone: false },
        orderBy: { createdAt: 'desc' },
      });
      if (latestMsg) {
        await prisma.chatThread.update({
          where: { id: threadId },
          data: { lastMessageText: latestMsg.content?.substring(0, 100) || '' },
        });
      } else {
        await prisma.chatThread.update({
          where: { id: threadId },
          data: { lastMessageText: null },
        });
      }

      // Broadcast delete event
      try {
        if ((global as any).socketGateway) {
          (global as any).socketGateway.broadcastToChat(threadId, 'chat:delete', {
            messageId, deletedFor: 'everyone', deletedByUserId: userId,
          });
        } else {
          await redisPublisher.publish(
            `thread:${threadId}:delete`,
            JSON.stringify({ messageId, deletedFor: 'everyone', deletedByUserId: userId })
          );
        }
      } catch (error) {
        console.error('Failed to broadcast delete:', error);
      }

      return { messageId, deletedFor: 'everyone' };

    } else {
      // "Delete for me" — create a per-user deletion record
      await prisma.chatMessageDeletion.upsert({
        where: {
          messageId_userId: { messageId, userId },
        },
        update: {}, // Already deleted for this user
        create: {
          messageId,
          userId,
        },
      });

      return { messageId, deletedFor: 'me' };
    }
  }

  // ============================================
  // ✅ SEND LOCATION (Swiggy-style: share truck driver's current position)
  // ============================================
  async sendLocation(threadId: string, lat: number, lng: number, userId: string, tripId?: string) {
    // Build metadata with nearby info if tripId is provided
    let metadata: any = { lat, lng };
    let content = '📍 Shared location';

    if (tripId) {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          status: true,
          startPoint: true,
          endPoint: true,
          truck: { select: { number: true } },
          driver: {
            include: { user: { select: { name: true } } },
          },
        },
      });

      if (trip) {
        metadata = {
          ...metadata,
          tripId: trip.id,
          truckNumber: trip.truck?.number,
          driverName: trip.driver?.user?.name,
          status: trip.status,
          startPoint: trip.startPoint,
          endPoint: trip.endPoint,
        };
        content = `📍 Live location: ${trip.truck?.number || 'Truck'} (${trip.driver?.user?.name || 'Driver'})`;
      }
    }

    return this.sendMessage(threadId, {
      content,
      messageType: 'LOCATION',
      locationLat: lat,
      locationLng: lng,
      tripId,
      metadata,
    } as any, userId);
  }

  // ✅ Get Unread Counts (computed per-user, not stored on thread)
  async getUnreadCounts(userId: string) {
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const orgIds = memberships.map(m => m.orgId);

    if (orgIds.length === 0) return [];

    // Get all threads for this user's orgs
    const threads = await prisma.chatThread.findMany({
      where: {
        OR: [
          { orgId: { in: orgIds } },
          { counterpartyOrgId: { in: orgIds } },
        ],
      },
      select: { id: true },
    });

    if (threads.length === 0) return [];

    // Compute unread counts per thread for THIS user
    // Only count messages from OTHER real users (not system, not self)
    const results = await Promise.all(
      threads.map(async (thread) => {
        const unreadCount = await prisma.chatMessage.count({
          where: {
            threadId: thread.id,
            senderUserId: { not: null },       // Exclude system messages
            NOT: { senderUserId: userId },      // Exclude MY messages
            isRead: false,
            isDeletedForEveryone: false,
            deletions: { none: { userId } },
          },
        });
        return { id: thread.id, unreadCount };
      })
    );

    // Only return threads with unread > 0
    return results.filter(r => r.unreadCount > 0);
  }

  // ✅ Message Search (excludes deleted messages)
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
        isDeletedForEveryone: false,
        deletions: { none: { userId } },
        OR: [
          { content: { contains: query, mode: 'insensitive' } },
          { payment: { reference: { contains: query } } },
          { invoice: { invoiceNumber: { contains: query } } },
        ],
      },
      include: {
        thread: {
          select: { id: true, orgId: true, counterpartyOrgId: true },
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
          senderUserId: null, // System message — no human sender
          messageType: 'SYSTEM_MESSAGE',
          metadata: metadata || Prisma.JsonNull,
          tripId, // ✅ Link message to trip
          // ✅ FIX: System messages are informational — mark as read/delivered
          // so they never inflate unread counts for either side
          isRead: true,
          readAt: new Date(),
          isDelivered: true,
          deliveredAt: new Date(),
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
          // System messages (no sender) → isRead:true (informational, shouldn't count as unread)
          // User messages (has sender) → isRead:false (receiver hasn't read it yet)
          isRead: !senderUserId,
          readAt: !senderUserId ? new Date() : null,
          isDelivered: !senderUserId,
          deliveredAt: !senderUserId ? new Date() : null,
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

  // ============================================
  // ✅ FEATURE 1: Media Preview (Chat Info screen)
  // ============================================
  async getMediaPreview(threadId: string, userId: string) {
    await this.getThreadById(threadId, userId);

    // Run 3 parallel count queries
    const [imageCount, docsCount, linksCount, previewMessages] = await Promise.all([
      prisma.chatMessage.count({
        where: { threadId, messageType: 'IMAGE', isDeletedForEveryone: false },
      }),
      prisma.chatMessage.count({
        where: { threadId, messageType: { in: ['PDF', 'FILE'] }, isDeletedForEveryone: false },
      }),
      prisma.chatMessage.count({
        where: {
          threadId,
          messageType: 'TEXT',
          isDeletedForEveryone: false,
          content: { contains: 'http' },
        },
      }),
      prisma.chatMessage.findMany({
        where: { threadId, messageType: 'IMAGE', isDeletedForEveryone: false },
        include: {
          attachments: {
            select: { id: true, url: true, mimeType: true, fileName: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    // Build preview array from messages that have attachments
    const preview = previewMessages
      .filter((m) => m.attachments.length > 0)
      .map((m) => ({
        messageId: m.id,
        url: m.attachments[0].url,
        mimeType: m.attachments[0].mimeType,
        createdAt: m.createdAt,
      }));

    return {
      imageCount,
      docsCount,
      linksCount,
      totalCount: imageCount + docsCount,
      preview,
    };
  }

  // ============================================
  // ✅ FEATURE 2: Media Gallery (paginated, cursor-based)
  // ============================================
  async getMediaGallery(
    threadId: string,
    userId: string,
    type: 'images' | 'docs' | 'all',
    limit: number,
    cursor?: string
  ) {
    await this.getThreadById(threadId, userId);

    // Build messageType filter
    let messageTypes: string[];
    switch (type) {
      case 'images': messageTypes = ['IMAGE']; break;
      case 'docs': messageTypes = ['PDF', 'FILE']; break;
      case 'all': messageTypes = ['IMAGE', 'PDF', 'FILE']; break;
    }

    // Build where clause with cursor-based pagination
    const where: any = {
      threadId,
      messageType: { in: messageTypes },
      isDeletedForEveryone: false,
    };

    if (cursor) {
      const cursorMessage = await prisma.chatMessage.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorMessage) {
        where.createdAt = { lt: cursorMessage.createdAt };
      }
    }

    // Fetch one extra to determine if there are more items
    const messages = await prisma.chatMessage.findMany({
      where,
      include: {
        attachments: {
          select: { id: true, url: true, mimeType: true, fileName: true, sizeBytes: true, type: true },
        },
        senderUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const sliced = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    const items = sliced.map((m) => ({
      messageId: m.id,
      url: m.attachments[0]?.url || null,
      mimeType: m.attachments[0]?.mimeType || null,
      fileName: m.attachments[0]?.fileName || null,
      sizeBytes: m.attachments[0]?.sizeBytes || null,
      senderName: m.senderUser?.name || null,
      createdAt: m.createdAt,
      attachments: m.attachments,
    }));

    return { items, nextCursor, hasMore };
  }

  // ============================================
  // ✅ FEATURE 3: Block Thread
  // ============================================
  async blockThread(threadId: string, userId: string) {
    const thread = await this.getThreadById(threadId, userId);

    // Get the user's org that is part of this thread
    const membership = await prisma.orgMember.findFirst({
      where: { userId, orgId: { in: [thread.orgId, thread.counterpartyOrgId] } },
    });
    if (!membership) throw new ForbiddenError('Not authorized');

    if (thread.blockedByOrgId) {
      throw new ConflictError('Already blocked');
    }

    const updated = await prisma.chatThread.update({
      where: { id: threadId },
      data: { blockedByOrgId: membership.orgId, blockedAt: new Date() },
      include: {
        org: { select: { id: true, name: true, gstin: true } },
        counterpartyOrg: { select: { id: true, name: true, gstin: true } },
      },
    });

    // Broadcast block event
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:blocked', {
          blockedByOrgId: membership.orgId,
          blockedAt: updated.blockedAt,
        });
      }
    } catch (error) {
      logger.error('Failed to broadcast block event', { threadId, error });
    }

    return updated;
  }

  // ============================================
  // ✅ FEATURE 3: Unblock Thread
  // ============================================
  async unblockThread(threadId: string, userId: string) {
    const thread = await this.getThreadById(threadId, userId);

    if (!thread.blockedByOrgId) {
      throw new ValidationError('Thread is not blocked');
    }

    // Get the user's org
    const membership = await prisma.orgMember.findFirst({
      where: { userId, orgId: { in: [thread.orgId, thread.counterpartyOrgId] } },
    });
    if (!membership) throw new ForbiddenError('Not authorized');

    // Only the org that blocked can unblock
    if (thread.blockedByOrgId !== membership.orgId) {
      throw new ForbiddenError('Only the org that blocked can unblock');
    }

    const updated = await prisma.chatThread.update({
      where: { id: threadId },
      data: { blockedByOrgId: null, blockedAt: null },
      include: {
        org: { select: { id: true, name: true, gstin: true } },
        counterpartyOrg: { select: { id: true, name: true, gstin: true } },
      },
    });

    // Broadcast unblock event
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:unblocked', {
          threadId,
        });
      }
    } catch (error) {
      logger.error('Failed to broadcast unblock event', { threadId, error });
    }

    return updated;
  }

  // ============================================
  // ✅ FEATURE 4: Clear Chat (soft-delete all messages)
  // ============================================
  async clearChat(threadId: string, userId: string) {
    await this.getThreadById(threadId, userId);

    // Get count before clearing
    const messageCount = await prisma.chatMessage.count({
      where: { threadId, isDeletedForEveryone: false },
    });

    await prisma.$transaction(async (tx) => {
      // Soft-delete all messages (preserve for audit trail)
      await tx.chatMessage.updateMany({
        where: { threadId, isDeletedForEveryone: false },
        data: { isDeletedForEveryone: true, deletedAt: new Date() },
      });

      // Clear thread preview
      await tx.chatThread.update({
        where: { id: threadId },
        data: { lastMessageText: null, lastMessageAt: null },
      });
    });

    // Broadcast clear event
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:cleared', {
          threadId, clearedAt: new Date(),
        });
      }
    } catch (error) {
      logger.error('Failed to broadcast clear event', { threadId, error });
    }

    return { clearedCount: messageCount, threadId };
  }

  // ============================================
  // ✅ FEATURE 4: Delete Thread (hard delete, owners only)
  // ============================================
  async deleteThread(threadId: string, userId: string) {
    const thread = await this.getThreadById(threadId, userId);

    // Verify the requesting user belongs to one of the thread's orgs
    const membership = await prisma.orgMember.findFirst({
      where: { userId, orgId: { in: [thread.orgId, thread.counterpartyOrgId] } },
    });
    if (!membership) throw new ForbiddenError('Not authorized to delete this thread');

    // Delete thread (CASCADE handles messages due to schema onDelete: Cascade)
    await prisma.chatThread.delete({
      where: { id: threadId },
    });

    // Broadcast delete event
    try {
      if ((global as any).socketGateway) {
        (global as any).socketGateway.broadcastToChat(threadId, 'chat:thread_deleted', {
          threadId,
        });
      }
    } catch (error) {
      logger.error('Failed to broadcast thread delete event', { threadId, error });
    }

    return { deleted: true, threadId };
  }
}
