import { z } from 'zod';
import { ChatMessageType } from '@prisma/client';

// ✅ NEW: Thread creation is now by org pair, not by trip
// Accepts counterpartyOrgId directly, or resolves org pair from accountId/tripId
export const createThreadSchema = z.object({
  counterpartyOrgId: z.string().cuid('Invalid org ID').optional(),
  accountId: z.string().cuid('Invalid account ID').optional(),
  tripId: z.string().cuid('Invalid trip ID').optional(), // Resolves org pair from trip
}).refine(
  (data) => data.counterpartyOrgId || data.accountId || data.tripId,
  {
    message: 'At least one of counterpartyOrgId, accountId, or tripId must be provided',
  }
);

export const sendMessageSchema = z.object({
  content: z.string().max(5000).optional(),
  messageType: z.nativeEnum(ChatMessageType).default('TEXT'),
  attachmentIds: z.array(z.string().cuid()).max(10).optional(),
  replyToId: z.string().cuid().optional(),
  clientMessageId: z.string().optional(),
  tripId: z.string().cuid().optional(), // ✅ NEW: Optional trip context for this message
}).refine(
  (data) => {
    // TEXT messages need content
    if (data.messageType === 'TEXT') {
      return data.content && data.content.trim().length > 0;
    }
    // IMAGE, PDF, FILE, AUDIO messages need attachments
    if (['IMAGE', 'PDF', 'FILE', 'AUDIO'].includes(data.messageType)) {
      return data.attachmentIds && data.attachmentIds.length > 0;
    }
    // Other types (SYSTEM, PAYMENT, etc.) handled internally
    return true;
  },
  {
    message: 'TEXT messages require content. IMAGE/PDF/FILE/AUDIO messages require attachments.',
  }
);

export type CreateThreadDto = z.infer<typeof createThreadSchema>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
