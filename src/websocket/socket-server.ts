/**
 * Socket.io server — emits real-time events to the dashboard.
 *
 * Events emitted:
 *   order:new        — { order }       when a new order is created
 *   order:updated    — { order }       when an order status changes
 *   stats:updated    — { stats }       after any order mutation
 */
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { logger } from '../utils/logger';
import { env } from '../config/env';

let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.NODE_ENV === 'production' ? false : '*',
    },
    path: '/ws',
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard client connected');
    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });
  });

  logger.info('Socket.io server initialized');
  return io;
}

export function emitOrderNew(order: unknown): void {
  io?.emit('order:new', { order });
}

export function emitOrderUpdated(order: unknown): void {
  io?.emit('order:updated', { order });
}

export function emitStatsUpdated(stats: unknown): void {
  io?.emit('stats:updated', { stats });
}

export function getIo(): SocketServer | null {
  return io;
}
