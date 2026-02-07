import { z } from 'zod';
import { ChatMessageType } from '@prisma/client';

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
  content: z.string().max(5000).optional(),
  messageType: z.nativeEnum(ChatMessageType).default('TEXT'),
  attachmentIds: z.array(z.string().cuid()).max(10).optional(),
  replyToId: z.string().cuid().optional(),
}).refine(
  (data) => {
    // TEXT messages need content
    if (data.messageType === 'TEXT') {
      return data.content && data.content.trim().length > 0;
    }
    // IMAGE, PDF, FILE messages need attachments
    if (['IMAGE', 'PDF', 'FILE'].includes(data.messageType)) {
      return data.attachmentIds && data.attachmentIds.length > 0;
    }
    // Other types (SYSTEM, PAYMENT, etc.) handled internally
    return true;
  },
  {
    message: 'TEXT messages require content. IMAGE/PDF/FILE messages require attachments.',
  }
);

export type CreateThreadDto = z.infer<typeof createThreadSchema>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
