import { z } from 'zod';

export const createDriverPaymentSchema = z.object({
  totalAmount: z.number().positive('Total amount must be positive'),
  paidBy: z.enum(['SOURCE', 'DESTINATION', 'SPLIT']).default('SOURCE'),
  splitSourceAmount: z.number().positive().optional(),
  splitDestAmount: z.number().positive().optional(),
  remarks: z.string().optional(),
});

export const recordDriverPaymentSchema = z.object({
  amount: z.number().positive('Payment amount must be positive'),
  remarks: z.string().optional(),
});

export type CreateDriverPaymentDto = z.infer<typeof createDriverPaymentSchema>;
export type RecordDriverPaymentDto = z.infer<typeof recordDriverPaymentSchema>;
