import * as admin from 'firebase-admin';
import { config } from './env';
import { logger } from '../utils/logger';

let firebaseApp: admin.app.App | null = null;

export function getFirebaseApp(): admin.app.App | null {
    if (firebaseApp) return firebaseApp;

    if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
        logger.warn('Firebase not configured — push notifications disabled. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY_BASE64');
        return null;
    }

    try {
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert({
                projectId: config.firebase.projectId,
                clientEmail: config.firebase.clientEmail,
                privateKey: config.firebase.privateKey,
            }),
        });
        logger.info('✅ Firebase Admin SDK initialized');
        return firebaseApp;
    } catch (error) {
        logger.error('Failed to initialize Firebase Admin SDK:', error);
        return null;
    }
}

export function getMessaging(): admin.messaging.Messaging | null {
    const app = getFirebaseApp();
    if (!app) return null;
    return admin.messaging(app);
}

// Helper: Send to a single FCM token
export async function sendFcmNotification(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
): Promise<boolean> {
    const messaging = getMessaging();
    if (!messaging) return false;

    try {
        await messaging.send({
            token: fcmToken,
            notification: { title, body },
            data: data || {},
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'mahajan_default',
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        });
        return true;
    } catch (error: any) {
        // Token invalid or app uninstalled — log but don't throw
        if (
            error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered'
        ) {
            logger.warn('FCM token invalid or expired', { fcmToken: fcmToken.substring(0, 20) + '...' });
            return false;
        }
        logger.error('FCM send failed:', error);
        return false;
    }
}

// Helper: Send to multiple tokens (multicast)
export async function sendFcmMulticast(
    fcmTokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>
): Promise<{ successCount: number; failureCount: number }> {
    const messaging = getMessaging();
    if (!messaging || fcmTokens.length === 0) return { successCount: 0, failureCount: 0 };

    try {
        const response = await messaging.sendEachForMulticast({
            tokens: fcmTokens,
            notification: { title, body },
            data: data || {},
            android: {
                priority: 'high',
                notification: { sound: 'default', channelId: 'mahajan_default' },
            },
            apns: {
                payload: { aps: { sound: 'default', badge: 1 } },
            },
        });
        return {
            successCount: response.successCount,
            failureCount: response.failureCount,
        };
    } catch (error) {
        logger.error('FCM multicast failed:', error);
        return { successCount: 0, failureCount: fcmTokens.length };
    }
}
