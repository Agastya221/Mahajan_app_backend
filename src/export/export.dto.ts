import { z } from 'zod';

export const exportRequestSchema = z.object({
  exportType: z.enum(['LEDGER', 'TRIPS', 'FULL_REPORT']),
  format: z.enum(['XLSX', 'PDF', 'CSV']).default('XLSX'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  counterpartyOrgId: z.string().cuid().optional(),
  includeItems: z.boolean().default(true),
  includePayments: z.boolean().default(true),
});

export type ExportRequestDto = z.infer<typeof exportRequestSchema>;
