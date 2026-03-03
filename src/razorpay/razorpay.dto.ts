import { z } from 'zod';
import { PaymentTag } from '@prisma/client';

// ============================================
// CREATE ORDER — Frontend calls before showing Razorpay checkout
// ============================================

// For existing ledger payments (payment request already exists)
export const createOrderForPaymentSchema = z.object({
    paymentId: z.string().cuid('Invalid payment ID'),
});

// For trip-level "Pay Now" (creates payment + order in one go)
export const createOrderForTripSchema = z.object({
    tripId: z.string().cuid('Invalid trip ID'),
    accountId: z.string().cuid('Invalid account ID'),
    amount: z.number().positive('Amount must be positive'),    // in rupees (₹185.50)
    tag: z.nativeEnum(PaymentTag).optional().default('OTHER'),
    remarks: z.string().max(500).optional(),
});

// For driver payments
export const createOrderForDriverPaymentSchema = z.object({
    tripId: z.string().cuid('Invalid trip ID'),
});

// ============================================
// VERIFY PAYMENT — Frontend calls after Razorpay checkout success
// ============================================

export const verifyPaymentSchema = z.object({
    razorpay_order_id: z.string().min(1, 'Order ID is required'),
    razorpay_payment_id: z.string().min(1, 'Payment ID is required'),
    razorpay_signature: z.string().min(1, 'Signature is required'),
});

// ============================================
// TYPES
// ============================================
export type CreateOrderForPaymentDto = z.infer<typeof createOrderForPaymentSchema>;
export type CreateOrderForTripDto = z.infer<typeof createOrderForTripSchema>;
export type CreateOrderForDriverPaymentDto = z.infer<typeof createOrderForDriverPaymentSchema>;
export type VerifyPaymentDto = z.infer<typeof verifyPaymentSchema>;
