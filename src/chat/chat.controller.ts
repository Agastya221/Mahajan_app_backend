import { Response } from 'express';
import { ChatService } from './chat.service';
import {
  createThreadSchema,
  updateThreadSchema,
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  searchMessagesSchema,
  chatActionSchema,
  startChatByPhoneSchema,
} from './chat.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { TripService } from '../trips/trip.service';
import { LedgerService } from '../ledger/ledger.service';
import prisma from '../config/database';

const chatService = new ChatService();
const tripService = new TripService();
const ledgerService = new LedgerService();

export class ChatController {
  // ════════════════════════════════════════════
  // THREADS — CRUD
  // ════════════════════════════════════════════

  /**
   * POST /chat/threads
   * Create or get an org-pair chat thread.
   * Body: { counterpartyOrgId?, accountId?, tripId? }
   */
  createThread = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createThreadSchema.parse(req.body);
    const result = await chatService.createOrGetThread(data, req.user!.id);

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      data: result.thread,
      message: result.isNew ? 'Thread created' : 'Thread already exists',
    });
  });

  /**
   * POST /chat/start-by-phone
   * Start a chat with a Mahajan by phone number (Add Mahajan feature).
   * Body: { phone }
   */
  startChatByPhone = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = startChatByPhoneSchema.parse(req.body);
    const result = await chatService.startChatByPhone(data.phone, req.user!.id);

    if (result.inviteRequired) {
      return res.status(202).json({
        success: true,
        data: result,
        message: 'Mahajan not found. Invite generated.',
      });
    }

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      data: result.thread,
      message: result.isNew ? 'Thread created' : 'Thread already exists',
    });
  });

  /**
   * GET /chat/threads
   * List all chat threads for the current user.
   * Query: ?page=1&limit=20
   */
  getThreads = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = req.query;

    const result = await chatService.getThreads(req.user!.id, {
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    res.json({
      success: true,
      data: result.threads,
      pagination: result.pagination,
    });
  });

  /**
   * GET /chat/threads/:threadId
   * Get a single thread by ID.
   */
  getThreadById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const thread = await chatService.getThreadById(threadId, req.user!.id);

    res.json({
      success: true,
      data: thread,
    });
  });

  /**
   * PATCH /chat/threads/:threadId
   * Unified thread update — pin, archive, read receipts, delivery acknowledgment.
   *
   * Body examples:
   *   { "isPinned": true }
   *   { "isArchived": false }
   *   { "readUpTo": "msg_abc123" }
   *   { "deliveredUpTo": "msg_abc123" }
   *   { "isPinned": true, "readUpTo": "msg_abc123" }   ← multiple ops in one call
   */
  updateThread = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const data = updateThreadSchema.parse(req.body);
    const userId = req.user!.id;

    const results: Record<string, any> = {};

    // ── Pin/Unpin ──
    if (data.isPinned !== undefined) {
      results.thread = await chatService.togglePinThread(threadId, userId, data.isPinned);
      results.pinned = data.isPinned;
    }

    // ── Archive/Unarchive ──
    if (data.isArchived !== undefined) {
      results.thread = await chatService.toggleArchiveThread(threadId, userId, data.isArchived);
      results.archived = data.isArchived;
    }

    // ── Mark as Read ──
    if (data.readUpTo) {
      const readResult = await chatService.markMessagesAsRead(threadId, userId, data.readUpTo);
      results.read = readResult;
    }

    // ── Mark as Delivered ──
    if (data.deliveredUpTo) {
      const deliveredResult = await chatService.markMessagesAsDelivered(threadId, userId, data.deliveredUpTo);
      results.delivered = deliveredResult;
    }

    res.json({
      success: true,
      data: results,
    });
  });

  // ════════════════════════════════════════════
  // MESSAGES
  // ════════════════════════════════════════════

  /**
   * GET /chat/threads/:threadId/messages
   * Get messages for a thread.
   * Query: ?limit=50&offset=0
   */
  getMessages = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await chatService.getMessages(threadId, req.user!.id, limit, offset);

    res.json({
      success: true,
      data: result,
    });
  });

  /**
   * POST /chat/threads/:threadId/messages
   * Send a message in a thread.
   * Body: { content, messageType, attachmentIds?, replyToId?, clientMessageId?, tripId?, locationLat?, locationLng? }
   */
  sendMessage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const data = sendMessageSchema.parse(req.body);

    const message = await chatService.sendMessage(threadId, data, req.user!.id);

    res.status(201).json({
      success: true,
      data: message,
    });
  });

  /**
   * PATCH /chat/threads/:threadId/messages/:messageId
   * Edit a text message (within 15 minutes, sender only).
   * Body: { content: "new text" }
   */
  editMessage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId, messageId } = req.params;
    const { content } = editMessageSchema.parse(req.body);

    const message = await chatService.editMessage(threadId, messageId, content, req.user!.id);

    res.json({
      success: true,
      data: message,
      message: 'Message edited',
    });
  });

  /**
   * DELETE /chat/threads/:threadId/messages/:messageId
   * Delete a message. Body: { deleteFor: "me" | "everyone" }
   * - "me": hides message only for the requesting user
   * - "everyone": soft-deletes for all (sender only, within 60 min)
   */
  deleteMessage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId, messageId } = req.params;
    const { deleteFor } = deleteMessageSchema.parse(req.body);

    const result = await chatService.deleteMessage(threadId, messageId, deleteFor, req.user!.id);

    res.json({
      success: true,
      data: result,
      message: deleteFor === 'everyone' ? 'Message deleted for everyone' : 'Message deleted for you',
    });
  });

  // ════════════════════════════════════════════
  // SEARCH & UNREAD
  // ════════════════════════════════════════════

  /**
   * GET /chat/unread
   * Get unread counts per thread for the current user.
   */
  getUnreadCounts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const counts = await chatService.getUnreadCounts(req.user!.id);

    res.json({
      success: true,
      data: counts,
    });
  });

  /**
   * GET /chat/messages?orgId=xxx&q=payment
   * Search messages across threads in an org.
   */
  searchMessages = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, q, query } = req.query;
    const searchQuery = (q || query) as string; // support both ?q= and legacy ?query=

    if (!orgId || !searchQuery) {
      return res.status(400).json({
        success: false,
        message: 'orgId and q are required',
      });
    }

    const messages = await chatService.searchMessages(
      orgId as string,
      req.user!.id,
      searchQuery
    );

    res.json({
      success: true,
      data: messages,
    });
  });

  // ════════════════════════════════════════════
  // ACTIONS — Rich actions inside conversation
  // ════════════════════════════════════════════

  /**
   * POST /chat/threads/:threadId/actions
   * Perform rich actions (Create Trip, Request Payment, Share Data) within chat.
   * Body: { actionType: "CREATE_TRIP", payload: { ... } }
   */
  performAction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const { actionType, payload } = chatActionSchema.parse(req.body);
    const userId = req.user!.id;

    let result;

    switch (actionType) {
      // ────────── TRIP ACTIONS ──────────
      case 'CREATE_TRIP': {
        // ✅ Auto-detect orgs from the org-pair thread
        let tripPayload = { ...payload };

        if (!tripPayload.sourceOrgId || !tripPayload.destinationOrgId) {
          const thread = await prisma.chatThread.findUnique({
            where: { id: threadId },
            select: {
              orgId: true,
              counterpartyOrgId: true,
              account: {
                select: {
                  ownerOrgId: true,
                  counterpartyOrgId: true,
                },
              },
            },
          });

          if (thread) {
            if (thread.account) {
              tripPayload.sourceOrgId = tripPayload.sourceOrgId || thread.account.ownerOrgId;
              tripPayload.destinationOrgId = tripPayload.destinationOrgId || thread.account.counterpartyOrgId;
            } else {
              tripPayload.sourceOrgId = tripPayload.sourceOrgId || thread.orgId;
              tripPayload.destinationOrgId = tripPayload.destinationOrgId || thread.counterpartyOrgId;
            }
          }
        }

        const trip = await tripService.createTrip(tripPayload as any, userId);
        await chatService.sendTripCard(threadId, trip, userId);
        result = trip;
        break;
      }

      // ────────── PAYMENT ACTIONS ──────────
      case 'REQUEST_PAYMENT': {
        result = await ledgerService.createPaymentRequest(payload as any, userId);
        break;
      }

      case 'MARK_PAYMENT_PAID': {
        result = await ledgerService.markPaymentAsPaid(payload as any, userId);
        break;
      }

      case 'CONFIRM_PAYMENT': {
        result = await ledgerService.confirmPayment(payload as any, userId);
        break;
      }

      case 'DISPUTE_PAYMENT': {
        result = await ledgerService.disputePayment(payload as any, userId);
        break;
      }

      // ────────── INVOICE ACTIONS ──────────
      case 'CREATE_INVOICE': {
        result = await ledgerService.createInvoice(payload as any, userId);
        break;
      }

      // ────────── DATA ACTIONS ──────────
      case 'SHARE_DATA_GRID': {
        await chatService.sendDataGrid(threadId, payload.title, payload.rows, userId);
        result = { message: 'Data grid shared' };
        break;
      }

      case 'SHARE_LEDGER_TIMELINE': {
        const timeline = await ledgerService.getLedgerTimeline(
          payload.accountId,
          userId,
          20,
          0
        );
        const rows = timeline.entries.map((entry: any) => ({
          Date: new Date(entry.createdAt).toLocaleDateString('en-IN'),
          Description: entry.description,
          Direction: entry.direction,
          Amount: `₹${Number(entry.amount).toLocaleString('en-IN')}`,
          Balance: `₹${Number(entry.balance).toLocaleString('en-IN')}`,
        }));
        await chatService.sendDataGrid(threadId, 'Ledger Timeline', rows, userId);
        result = { entries: timeline.entries.length };
        break;
      }
    }

    res.json({
      success: true,
      data: result,
    });
  });
}
