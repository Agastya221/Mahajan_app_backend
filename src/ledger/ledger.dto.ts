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

export const createPaymentSchema = z.object({
  accountId: z.cuid('Invalid account ID'),
  amount: z.number().positive('Amount must be positive'),
  tag: z.enum(PaymentTag),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  transactionId: z.string().optional(),
  remarks: z.string().optional(),
  attachmentIds: z.array(z.cuid()).optional(),
});

export type CreateAccountDto = z.infer<typeof createAccountSchema>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;
export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;
