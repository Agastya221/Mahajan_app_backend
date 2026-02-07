import { z } from 'zod';

export const submitGstinSchema = z.object({
  gstin: z.string().regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
    'Invalid GSTIN format (15 chars: 2-digit state + 10 PAN + 1 entity + 1 Z + 1 check)'
  ),
});

export type SubmitGstinDto = z.infer<typeof submitGstinSchema>;
