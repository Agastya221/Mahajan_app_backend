import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { redisSubscriber, redisClient } from '../config/redis';
import { config } from '../config/env';
import prisma from '../config/database';
import { logger } from '../utils/logger';

interface SocketData {
  user: {
    id: string;
    phone: string;
    role: string;
  };
}

export class SocketGateway {
  private io: Server;

  constructor(httpServer: HttpServer) {
    // Parse allowed origins from config (supports comma-separated list)
    const allowedOrigins = config.cors.origin.split(',').map(o => o.trim());

    this.io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          // Allow requests with no origin (mobile apps, etc.)
          if (!origin) {
            return callback(null, true);
          }

          // Check if origin is in allowed list
          if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            return callback(null, true);
          }

          // In development, allow localhost variations
          if (config.nodeEnv === 'development' && origin.includes('localhost')) {
            return callback(null, true);
          }

          callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
      },
      path: '/socket.io/',
    });

    this.setupMiddleware();
    this.setupHandlers();
    this.subscribeToRedis();
  }

  private setupMiddleware() {
    this.io.use(async (socket: Socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        // Check if token is blacklisted (user logged out)
        try {
          const isBlacklisted = await redisClient.get(`bl:${token}`);
          if (isBlacklisted) {
            logger.warn('WebSocket connection attempt with blacklisted token');
            return next(new Error('Token has been revoked'));
          }
        } catch (redisError) {
          // If Redis is down, log but allow connection (fail-open for WebSocket)
          // This is acceptable as WebSocket is for real-time updates, not auth-critical operations
          logger.warn('Redis unavailable for WebSocket token blacklist check', { error: redisError });
        }

        const decoded = jwt.verify(token, config.jwt.accessSecret) as any;

        // Verify user still exists and is active
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, phone: true, role: true, status: true },
        });

        if (!user) {
          return next(new Error('User not found'));
        }

        if (user.status !== 'ACTIVE') {
          return next(new Error('Account has been suspended or banned'));
        }

        (socket.data as SocketData).user = {
          id: user.id,
          phone: user.phone,
          role: user.role,
        };
        next();
      } catch (err) {
        next(new Error('Invalid token'));
      }
    });
  }

  private setupHandlers() {
    this.io.on('connection', (socket: Socket) => {
      const user = (socket.data as SocketData).user;
      console.log(`Client connected: ${socket.id} (User: ${user.id})`);

      // Subscribe to trip location updates
      socket.on('tracking:subscribe', async ({ tripId }: { tripId: string }) => {
        try {
          // Verify user has access to this trip
          const hasAccess = await this.verifyTripAccess(tripId, user.id);
          if (!hasAccess) {
            socket.emit('error', { message: 'Not authorized to view this trip' });
            return;
          }

          socket.join(`trip:${tripId}`);
          console.log(`Socket ${socket.id} joined trip:${tripId}`);
          socket.emit('tracking:subscribed', { tripId });
        } catch (error) {
          console.error('Error subscribing to trip:', error);
          socket.emit('error', { message: 'Failed to subscribe to trip' });
        }
      });

      socket.on('tracking:unsubscribe', ({ tripId }: { tripId: string }) => {
        socket.leave(`trip:${tripId}`);
        console.log(`Socket ${socket.id} left trip:${tripId}`);
        socket.emit('tracking:unsubscribed', { tripId });
      });

      // Join org room
      socket.on('org:join', async ({ orgId }: { orgId: string }) => {
        try {
          // Verify user is member of org
          const isMember = await this.verifyOrgMembership(orgId, user.id);
          if (!isMember) {
            socket.emit('error', { message: 'Not a member of this organization' });
            return;
          }

          socket.join(`org:${orgId}`);
          console.log(`Socket ${socket.id} joined org:${orgId}`);
          socket.emit('org:joined', { orgId });
        } catch (error) {
          console.error('Error joining org:', error);
          socket.emit('error', { message: 'Failed to join organization' });
        }
      });

      socket.on('org:leave', ({ orgId }: { orgId: string }) => {
        socket.leave(`org:${orgId}`);
        console.log(`Socket ${socket.id} left org:${orgId}`);
        socket.emit('org:left', { orgId });
      });

      // Join chat thread
      socket.on('chat:join', async ({ threadId }: { threadId: string }) => {
        try {
          // Verify user has access to chat thread
          const hasAccess = await this.verifyChatAccess(threadId, user.id);
          if (!hasAccess) {
            socket.emit('error', { message: 'Not authorized to view this chat' });
            return;
          }

          socket.join(`chat:${threadId}`);
          console.log(`Socket ${socket.id} joined chat:${threadId}`);
          socket.emit('chat:joined', { threadId });
        } catch (error) {
          console.error('Error joining chat:', error);
          socket.emit('error', { message: 'Failed to join chat' });
        }
      });

      socket.on('chat:leave', ({ threadId }: { threadId: string }) => {
        socket.leave(`chat:${threadId}`);
        console.log(`Socket ${socket.id} left chat:${threadId}`);
        socket.emit('chat:left', { threadId });
      });

      // Join account room (for ledger updates)
      socket.on('account:join', async ({ accountId }: { accountId: string }) => {
        try {
          // Verify user has access to account
          const hasAccess = await this.verifyAccountAccess(accountId, user.id);
          if (!hasAccess) {
            socket.emit('error', { message: 'Not authorized to view this account' });
            return;
          }

          socket.join(`account:${accountId}`);
          console.log(`Socket ${socket.id} joined account:${accountId}`);
          socket.emit('account:joined', { accountId });
        } catch (error) {
          console.error('Error joining account:', error);
          socket.emit('error', { message: 'Failed to join account' });
        }
      });

      socket.on('account:leave', ({ accountId }: { accountId: string }) => {
        socket.leave(`account:${accountId}`);
        console.log(`Socket ${socket.id} left account:${accountId}`);
        socket.emit('account:left', { accountId });
      });

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
  }

  private subscribeToRedis() {
    // Subscribe to all trip location and status channels using pattern matching
    redisSubscriber.psubscribe('trip:*:location', (err, count) => {
      if (err) {
        console.error('Failed to subscribe to Redis location channels:', err);
        return;
      }
      console.log(`Subscribed to ${count} Redis location channel pattern(s)`);
    });

    redisSubscriber.psubscribe('trip:*:status', (err, count) => {
      if (err) {
        console.error('Failed to subscribe to Redis status channels:', err);
        return;
      }
      console.log(`Subscribed to ${count} Redis status channel pattern(s)`);
    });

    redisSubscriber.on('pmessage', (pattern, channel, message) => {
      try {
        const tripId = channel.split(':')[1];
        const data = JSON.parse(message);

        if (pattern === 'trip:*:location') {
          // Broadcast location update to all sockets in the trip room
          this.io.to(`trip:${tripId}`).emit('tracking:location-update', data);
        } else if (pattern === 'trip:*:status') {
          // Broadcast status update (e.g., DELIVERED) to all sockets in the trip room
          this.io.to(`trip:${tripId}`).emit('trip:status-update', data);
          console.log(`📢 Broadcasted status update for trip ${tripId}:`, data.status);
        }
      } catch (error) {
        console.error('Error handling Redis message:', error);
      }
    });

    redisSubscriber.on('error', (err) => {
      console.error('Redis subscriber error:', err);
    });
  }

  // Helper methods for broadcasting from services
  broadcastToTrip(tripId: string, event: string, data: any) {
    this.io.to(`trip:${tripId}`).emit(event, data);
  }

  broadcastToOrg(orgId: string, event: string, data: any) {
    this.io.to(`org:${orgId}`).emit(event, data);
  }

  broadcastToAccount(accountId: string, event: string, data: any) {
    this.io.to(`account:${accountId}`).emit(event, data);
  }

  broadcastToChat(threadId: string, event: string, data: any) {
    this.io.to(`chat:${threadId}`).emit(event, data);
  }

  // Access verification methods
  private async verifyTripAccess(tripId: string, userId: string): Promise<boolean> {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        sourceOrgId: true,
        destinationOrgId: true,
      },
    });

    if (!trip) return false;

    const membership = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
      },
    });

    return !!membership;
  }

  private async verifyOrgMembership(orgId: string, userId: string): Promise<boolean> {
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId,
        },
      },
    });

    return !!membership;
  }

  private async verifyChatAccess(threadId: string, userId: string): Promise<boolean> {
    const thread = await prisma.chatThread.findUnique({
      where: { id: threadId },
      include: {
        trip: {
          select: {
            sourceOrgId: true,
            destinationOrgId: true,
          },
        },
        account: {
          select: {
            ownerOrgId: true,
            counterpartyOrgId: true,
          },
        },
      },
    });

    if (!thread) return false;

    let orgIds: string[] = [];

    if (thread.trip) {
      orgIds = [thread.trip.sourceOrgId, thread.trip.destinationOrgId];
    } else if (thread.account) {
      orgIds = [thread.account.ownerOrgId, thread.account.counterpartyOrgId];
    }

    if (orgIds.length === 0) return false;

    const membership = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: orgIds },
      },
    });

    return !!membership;
  }

  private async verifyAccountAccess(accountId: string, userId: string): Promise<boolean> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        ownerOrgId: true,
        counterpartyOrgId: true,
      },
    });

    if (!account) return false;

    const membership = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [account.ownerOrgId, account.counterpartyOrgId] },
      },
    });

    return !!membership;
  }

  getIO(): Server {
    return this.io;
  }
}
