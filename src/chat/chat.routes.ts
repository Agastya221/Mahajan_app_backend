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
 * @route   POST /api/v1/chat/start-by-phone
 * @desc    Start a chat with a Mahajan by phone number (Add Mahajan feature)
 * @access  Private
 */
router.post('/start-by-phone', authenticate, chatController.startChatByPhone);

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

/**
 * @route   PATCH /api/v1/chat/threads/:threadId/messages/:messageId
 * @desc    Edit a text message (sender only, within 15 minutes)
 * @access  Private
 */
router.patch('/threads/:threadId/messages/:messageId', authenticate, chatController.editMessage);

/**
 * @route   DELETE /api/v1/chat/threads/:threadId/messages/:messageId
 * @desc    Delete a message (for me or for everyone)
 * @access  Private
 */
router.delete('/threads/:threadId/messages/:messageId', authenticate, chatController.deleteMessage);

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
