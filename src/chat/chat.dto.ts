import { z } from 'zod';

export const createThreadSchema = z.object({
  accountId: z.string().cuid('Invalid account ID').optional(),
  tripId: z.string().cuid('Invalid trip ID').optional(),
}).refine(
  (data) => (data.accountId && !data.tripId) || (!data.accountId && data.tripId),
  {
    message: 'Either accountId or tripId must be provided, but not both',
  }
);

export const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').optional(),
  attachmentIds: z.array(z.string().cuid()).optional(),
}).refine(
  (data) => data.content || (data.attachmentIds && data.attachmentIds.length > 0),
  {
    message: 'Either content or attachments must be provided',
  }
);

export type CreateThreadDto = z.infer<typeof createThreadSchema>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
