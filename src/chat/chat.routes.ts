import { Router } from 'express';
import { ChatController } from './chat.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const chatController = new ChatController();

// ════════════════════════════════════════════
// THREADS
// ════════════════════════════════════════════

/**
 * @route   POST /api/v1/chat/threads
 * @desc    Create or get org-pair chat thread
 * @access  Private
 */
router.post('/threads', authenticate, chatController.createThread);

/**
 * @route   GET /api/v1/chat/threads
 * @desc    List all chat threads for the current user
 * @access  Private
 */
router.get('/threads', authenticate, chatController.getThreads);

/**
 * @route   GET /api/v1/chat/threads/:threadId
 * @desc    Get chat thread by ID
 * @access  Private
 */
router.get('/threads/:threadId', authenticate, chatController.getThreadById);

/**
 * @route   PATCH /api/v1/chat/threads/:threadId
 * @desc    Update thread state (pin, archive, mark read, mark delivered)
 * @access  Private
 * @body    { isPinned?, isArchived?, markAsRead?, markAsDelivered? }
 */
router.patch('/threads/:threadId', authenticate, chatController.updateThread);

// ════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════

/**
 * @route   GET /api/v1/chat/threads/:threadId/messages
 * @desc    Get messages for a thread
 * @access  Private
 */
router.get('/threads/:threadId/messages', authenticate, chatController.getMessages);

/**
 * @route   POST /api/v1/chat/threads/:threadId/messages
 * @desc    Send message in thread
 * @access  Private
 */
router.post('/threads/:threadId/messages', authenticate, chatController.sendMessage);

// ════════════════════════════════════════════
// SEARCH & UNREAD
// ════════════════════════════════════════════

/**
 * @route   GET /api/v1/chat/unread
 * @desc    Get unread counts per thread
 * @access  Private
 */
router.get('/unread', authenticate, chatController.getUnreadCounts);

/**
 * @route   GET /api/v1/chat/messages
 * @desc    Search messages across threads (?orgId=xxx&q=payment)
 * @access  Private
 */
router.get('/messages', authenticate, chatController.searchMessages);

// ════════════════════════════════════════════
// ACTIONS — Rich actions inside conversation
// ════════════════════════════════════════════

/**
 * @route   POST /api/v1/chat/threads/:threadId/actions
 * @desc    Perform rich actions (Create Trip, Request Payment, Share Data, etc.)
 * @access  Private
 */
router.post('/threads/:threadId/actions', authenticate, chatController.performAction);

export default router;
