import { Response } from 'express';
import { ChatService } from './chat.service';
import { createThreadSchema, sendMessageSchema } from './chat.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const chatService = new ChatService();

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
    const { accountId, tripId, page, limit } = req.query;

    const result = await chatService.getThreads(req.user!.id, {
      accountId: accountId as string | undefined,
      tripId: tripId as string | undefined,
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

  setTyping = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const { isTyping } = req.body;

    const result = await chatService.setTyping(threadId, req.user!.id, isTyping);

    res.json({
      success: true,
      data: result,
    });
  });

  getTyping = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { threadId } = req.params;
    const typers = await chatService.getActiveTypers(threadId, req.user!.id);

    res.json({
      success: true,
      data: typers,
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
}
