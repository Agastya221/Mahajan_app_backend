import { z } from 'zod';
import { ChatMessageType } from '@prisma/client';

// ✅ Thread creation — org-pair architecture
// Accepts counterpartyOrgId directly, or resolves org pair from accountId/tripId
export const createThreadSchema = z.object({
  counterpartyOrgId: z.string().cuid('Invalid org ID').optional(),
  accountId: z.string().cuid('Invalid account ID').optional(),
  tripId: z.string().cuid('Invalid trip ID').optional(),
}).refine(
  (data) => data.counterpartyOrgId || data.accountId || data.tripId,
  {
    message: 'At least one of counterpartyOrgId, accountId, or tripId must be provided',
  }
);

export const startChatByPhoneSchema = z.object({
  phone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number'),
});

// ✅ v3: Unified PATCH — pin, archive, read, delivered all in one endpoint
export const updateThreadSchema = z.object({
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  readUpTo: z.string().optional(),
  deliveredUpTo: z.string().optional(),
}).refine(
  (data) => data.isPinned !== undefined || data.isArchived !== undefined || data.readUpTo !== undefined || data.deliveredUpTo !== undefined,
  {
    message: 'At least one of isPinned, isArchived, readUpTo, or deliveredUpTo must be provided',
  }
);

// ✅ Send message — optional tripId for trip context, location support
export const sendMessageSchema = z.object({
  content: z.string().max(5000).optional(),
  messageType: z.nativeEnum(ChatMessageType).default('TEXT'),
  attachmentIds: z.array(z.string().cuid()).max(10).optional(),
  replyToId: z.string().cuid().optional(),
  clientMessageId: z.string().optional(),
  tripId: z.string().cuid().optional(),
  // ✅ Location sharing (Swiggy-style driver tracking)
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
}).refine(
  (data) => {
    if (data.messageType === 'TEXT') {
      return data.content && data.content.trim().length > 0;
    }
    if (['IMAGE', 'PDF', 'FILE', 'AUDIO'].includes(data.messageType)) {
      return data.attachmentIds && data.attachmentIds.length > 0;
    }
    if (data.messageType === 'LOCATION') {
      return data.locationLat !== undefined && data.locationLng !== undefined;
    }
    return true;
  },
  {
    message: 'TEXT messages require content. IMAGE/PDF/FILE/AUDIO messages require attachments. LOCATION messages require locationLat and locationLng.',
  }
);

// ✅ Edit message — only TEXT, within 15 minutes, by original sender
export const editMessageSchema = z.object({
  content: z.string().min(1).max(5000, 'Message too long'),
});

// ✅ Delete message — "Delete for me" or "Delete for everyone"
export const deleteMessageSchema = z.object({
  deleteFor: z.enum(['me', 'everyone']),
});

// ✅ Search messages
export const searchMessagesSchema = z.object({
  orgId: z.string().cuid('Invalid org ID'),
  q: z.string().min(1, 'Search query is required'),
});

// ✅ Chat action — rich actions inside conversation
export const chatActionSchema = z.object({
  actionType: z.enum([
    'CREATE_TRIP',
    'REQUEST_PAYMENT',
    'MARK_PAYMENT_PAID',
    'CONFIRM_PAYMENT',
    'DISPUTE_PAYMENT',
    'CREATE_INVOICE',
    'SHARE_DATA_GRID',
    'SHARE_LEDGER_TIMELINE',
  ]),
  payload: z.record(z.string(), z.any()),
});

export type CreateThreadDto = z.infer<typeof createThreadSchema>;
export type UpdateThreadDto = z.infer<typeof updateThreadSchema>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
export type EditMessageDto = z.infer<typeof editMessageSchema>;
export type DeleteMessageDto = z.infer<typeof deleteMessageSchema>;
export type ChatActionDto = z.infer<typeof chatActionSchema>;
export type StartChatByPhoneDto = z.infer<typeof startChatByPhoneSchema>;
