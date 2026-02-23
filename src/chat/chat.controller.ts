import { Response } from 'express';
import { ChatService } from './chat.service';
import { createThreadSchema, sendMessageSchema } from './chat.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { TripService } from '../trips/trip.service';
import { LedgerService } from '../ledger/ledger.service';
import prisma from '../config/database';

const chatService = new ChatService();
const tripService = new TripService();
const ledgerService = new LedgerService();

export class ChatController {
  createThread = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createThreadSchema.parse(req.body);
    const result = await chatService.createOrGetThread(data, req.user!.id);

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      data: result.thread,
      message: result.isNew ? 'Thread created' : 'Thread already exists',
    });
  });

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

  getThreadById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const thread = await chatService.getThreadById(threadId, req.user!.id);

    res.json({
      success: true,
      data: thread,
    });
  });

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

  sendMessage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const data = sendMessageSchema.parse(req.body);

    const message = await chatService.sendMessage(threadId, data, req.user!.id);

    res.status(201).json({
      success: true,
      data: message,
    });
  });

  // ✅ WhatsApp-like Features
  markAsRead = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const result = await chatService.markMessagesAsRead(threadId, req.user!.id);

    res.json({
      success: true,
      data: result,
      message: `Marked ${result.count} message(s) as read`,
    });
  });

  markAsDelivered = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const result = await chatService.markMessagesAsDelivered(threadId, req.user!.id);

    res.json({
      success: true,
      data: result,
      message: `Marked ${result.count} message(s) as delivered`,
    });
  });

  togglePin = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const { isPinned } = req.body;

    const thread = await chatService.togglePinThread(threadId, req.user!.id, isPinned);

    res.json({
      success: true,
      data: thread,
      message: isPinned ? 'Thread pinned' : 'Thread unpinned',
    });
  });

  toggleArchive = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const { isArchived } = req.body;

    const thread = await chatService.toggleArchiveThread(threadId, req.user!.id, isArchived);

    res.json({
      success: true,
      data: thread,
      message: isArchived ? 'Thread archived' : 'Thread unarchived',
    });
  });

  getUnreadCounts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const counts = await chatService.getUnreadCounts(req.user!.id);

    res.json({
      success: true,
      data: counts,
    });
  });

  searchMessages = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, query } = req.query;

    if (!orgId || !query) {
      return res.status(400).json({
        success: false,
        message: 'orgId and query are required',
      });
    }

    const messages = await chatService.searchMessages(
      orgId as string,
      req.user!.id,
      query as string
    );

    res.json({
      success: true,
      data: messages,
    });
  });

  // ============================================
  // ✅ SUPER APP: All-in-one chat action hub
  // Actions happen INSIDE the org-pair chat.
  // Trips, payments, invoices all live in one conversation.
  // ============================================
  performAction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const { actionType, payload } = req.body;
    const userId = req.user!.id;

    if (!actionType) {
      res.status(400).json({ success: false, message: 'actionType is required' });
      return;
    }

    let result;

    switch (actionType) {
      // ────────── TRIP ACTIONS ──────────
      case 'CREATE_TRIP': {
        // ✅ SMART AUTO-DETECTION: Thread knows both orgs
        let tripPayload = { ...payload };

        if (!tripPayload.sourceOrgId || !tripPayload.destinationOrgId) {
          // Fetch thread to get org pair directly
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
            // Use account relationship if available (preserves owner/counterparty semantics)
            if (thread.account) {
              tripPayload.sourceOrgId = tripPayload.sourceOrgId || thread.account.ownerOrgId;
              tripPayload.destinationOrgId = tripPayload.destinationOrgId || thread.account.counterpartyOrgId;
            } else {
              // Fallback to thread orgs (normalized order, may need frontend to specify direction)
              tripPayload.sourceOrgId = tripPayload.sourceOrgId || thread.orgId;
              tripPayload.destinationOrgId = tripPayload.destinationOrgId || thread.counterpartyOrgId;
            }
          }
        }

        const trip = await tripService.createTrip(tripPayload, userId);
        // ✅ Send trip as a card INSIDE this org-pair chat
        await chatService.sendTripCard(threadId, trip, userId);
        result = trip;
        break;
      }

      // ────────── PAYMENT ACTIONS (GPay-like, real ledger) ──────────
      case 'REQUEST_PAYMENT': {
        const payment = await ledgerService.createPaymentRequest(payload, userId);
        result = payment;
        break;
      }

      case 'MARK_PAYMENT_PAID': {
        const paidResult = await ledgerService.markPaymentAsPaid(payload, userId);
        result = paidResult;
        break;
      }

      case 'CONFIRM_PAYMENT': {
        const confirmResult = await ledgerService.confirmPayment(payload, userId);
        result = confirmResult;
        break;
      }

      case 'DISPUTE_PAYMENT': {
        const disputeResult = await ledgerService.disputePayment(payload, userId);
        result = disputeResult;
        break;
      }

      // ────────── INVOICE ACTIONS ──────────
      case 'CREATE_INVOICE': {
        const invoice = await ledgerService.createInvoice(payload, userId);
        result = invoice;
        break;
      }

      // ────────── DATA ACTIONS (Excel-like) ──────────
      case 'SHARE_DATA_GRID': {
        await chatService.sendDataGrid(threadId, payload.title, payload.rows, userId);
        result = { success: true, message: 'Data grid shared' };
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
        result = { success: true, entries: timeline.entries.length };
        break;
      }

      default:
        res.status(400).json({ success: false, message: `Unknown action: ${actionType}` });
        return;
    }

    res.json({
      success: true,
      data: result,
    });
  });
}
