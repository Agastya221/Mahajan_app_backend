import { z } from 'zod';
import { PaymentTag } from '@prisma/client';

export const createAccountSchema = z.object({
  ownerOrgId: z.string().cuid('Invalid owner organization ID'),
  counterpartyOrgId: z.string().cuid('Invalid counterparty organization ID'),
});

export const createInvoiceSchema = z.object({
  accountId: z.cuid('Invalid account ID'),
  invoiceNumber: z.string().min(1, 'Invoice number is required'),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().optional(),
  dueDate: z.iso.datetime().optional(),
  attachmentIds: z.array(z.cuid()).optional(),
});

export const updateInvoiceSchema = z.object({
  isPaid: z.boolean().optional(),
  paidAmount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

// Legacy: Direct payment recording (for backward compatibility / cash payments)
export const createPaymentSchema = z.object({
  accountId: z.cuid('Invalid account ID'),
  amount: z.number().positive('Amount must be positive'),
  tag: z.nativeEnum(PaymentTag),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  transactionId: z.string().optional(),
  remarks: z.string().optional(),
  attachmentIds: z.array(z.cuid()).optional(),
});

// ============================================
// NEW: Two-Party Payment Confirmation Flow
// ============================================

// Step 1: Receiver creates payment request
export const createPaymentRequestSchema = z.object({
  accountId: z.string().cuid('Invalid account ID'),
  amount: z.number().positive('Amount must be positive'),
  tag: z.nativeEnum(PaymentTag).optional(),
  remarks: z.string().max(500).optional(),
  invoiceId: z.string().cuid().optional(),
});

// Step 2: Sender marks payment as paid
export const markPaymentPaidSchema = z.object({
  paymentId: z.string().cuid('Invalid payment ID'),
  mode: z.enum(['UPI', 'BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER']),
  utrNumber: z.string().max(50).optional(),
  proofNote: z.string().max(500).optional(),
  attachmentIds: z.array(z.string().cuid()).optional(),
});

// Step 3a: Receiver confirms payment
export const confirmPaymentSchema = z.object({
  paymentId: z.string().cuid('Invalid payment ID'),
});

// Step 3b: Receiver disputes payment
export const disputePaymentSchema = z.object({
  paymentId: z.string().cuid('Invalid payment ID'),
  reason: z.string().min(1, 'Dispute reason is required').max(500),
});

// Legacy types
export type CreateAccountDto = z.infer<typeof createAccountSchema>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;
export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;

// New payment flow types
export type CreatePaymentRequestDto = z.infer<typeof createPaymentRequestSchema>;
export type MarkPaymentPaidDto = z.infer<typeof markPaymentPaidSchema>;
export type ConfirmPaymentDto = z.infer<typeof confirmPaymentSchema>;
export type DisputePaymentDto = z.infer<typeof disputePaymentSchema>;
