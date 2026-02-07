import { Router } from 'express';
import { ChatController } from './chat.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const chatController = new ChatController();

/**
 * @route   POST /api/v1/chat/threads
 * @desc    Create or get chat thread
 * @access  Private
 */
router.post('/threads', authenticate, chatController.createThread);

/**
 * @route   GET /api/v1/chat/threads
 * @desc    Get all chat threads for user
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
 * @route   POST /api/v1/chat/threads/:threadId/read
 * @desc    Mark messages as read
 * @access  Private
 */
router.post('/threads/:threadId/read', authenticate, chatController.markAsRead);

/**
 * @route   POST /api/v1/chat/threads/:threadId/delivered
 * @desc    Mark messages as delivered (single tick)
 * @access  Private
 */
router.post('/threads/:threadId/delivered', authenticate, chatController.markAsDelivered);

/**
 * @route   POST /api/v1/chat/threads/:threadId/pin
 * @desc    Pin/unpin thread
 * @access  Private
 */
router.post('/threads/:threadId/pin', authenticate, chatController.togglePin);

/**
 * @route   POST /api/v1/chat/threads/:threadId/archive
 * @desc    Archive/unarchive thread
 * @access  Private
 */
router.post('/threads/:threadId/archive', authenticate, chatController.toggleArchive);

/**
 * @route   GET /api/v1/chat/unread
 * @desc    Get unread counts per thread
 * @access  Private
 */
router.get('/unread', authenticate, chatController.getUnreadCounts);

/**
 * @route   GET /api/v1/chat/search
 * @desc    Search messages in org
 * @access  Private
 */
router.get('/search', authenticate, chatController.searchMessages);

export default router;
