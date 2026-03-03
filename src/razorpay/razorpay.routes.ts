import { Router } from 'express';
import { RazorpayController } from './razorpay.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const razorpayController = new RazorpayController();

// ════════════════════════════════════════════
// ORDER CREATION (all require auth)
// ════════════════════════════════════════════

/**
 * @route   POST /api/v1/razorpay/create-order/payment
 * @desc    Create Razorpay order for an existing ledger payment request
 * @access  Private (debtor org member)
 */
router.post('/create-order/payment', authenticate, razorpayController.createOrderForPayment);

/**
 * @route   POST /api/v1/razorpay/create-order/trip
 * @desc    Create Razorpay order for a trip-level payment (creates Payment + Order)
 * @access  Private (trip org member)
 */
router.post('/create-order/trip', authenticate, razorpayController.createOrderForTrip);

/**
 * @route   POST /api/v1/razorpay/create-order/driver
 * @desc    Create Razorpay order for a driver payment
 * @access  Private (source/dest org member)
 */
router.post('/create-order/driver', authenticate, razorpayController.createOrderForDriverPayment);

// ════════════════════════════════════════════
// VERIFICATION
// ════════════════════════════════════════════

/**
 * @route   POST /api/v1/razorpay/verify
 * @desc    Verify Razorpay payment signature and auto-confirm
 * @access  Private
 */
router.post('/verify', authenticate, razorpayController.verifyPayment);

/**
 * @route   GET /api/v1/razorpay/order/:orderId/status
 * @desc    Check Razorpay order status
 * @access  Private
 */
router.get('/order/:orderId/status', authenticate, razorpayController.getOrderStatus);

// ════════════════════════════════════════════
// WEBHOOK (no auth — Razorpay signs with webhook secret)
// ════════════════════════════════════════════

/**
 * @route   POST /api/v1/razorpay/webhook
 * @desc    Razorpay server-to-server webhook handler
 * @access  Public (signature verified via X-Razorpay-Signature header)
 */
router.post('/webhook', razorpayController.handleWebhook);

export default router;
