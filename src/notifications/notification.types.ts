export enum NotificationType {
  TRIP_CREATED = 'TRIP_CREATED',
  TRIP_STATUS_CHANGED = 'TRIP_STATUS_CHANGED',
  LOAD_CARD_CREATED = 'LOAD_CARD_CREATED',
  RECEIVE_CARD_CREATED = 'RECEIVE_CARD_CREATED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  INVOICE_CREATED = 'INVOICE_CREATED',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
}

export interface NotificationPayload {
  type: NotificationType;
  recipientUserId?: string;
  recipientOrgId?: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}
