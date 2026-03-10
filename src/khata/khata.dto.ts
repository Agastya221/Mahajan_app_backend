import { z } from 'zod';

export const createKhataContactSchema = z.object({
    name: z.string().min(1).max(100),
    phone: z.string().regex(/^\+91\d{10}$/).optional(),
    city: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
});

export const updateKhataContactSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().regex(/^\+91\d{10}$/).nullable().optional(),
    city: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
});

export const recordKhataEntrySchema = z.object({
    direction: z.enum(['PAYABLE', 'RECEIVABLE']),
    amount: z.number().positive(),
    description: z.string().max(300).optional(),
    transactionType: z.enum(['SALE', 'PURCHASE', 'ADJUSTMENT']).optional(),
});

export const recordKhataPaymentSchema = z.object({
    amount: z.number().positive(),
    mode: z.enum(['CASH', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'OTHER']).optional(),
    tag: z.enum(['ADVANCE', 'PARTIAL', 'FINAL', 'OTHER']).optional(),
    remarks: z.string().max(300).optional(),
});
