import type { FastifyInstance } from 'fastify';
import type { StringValue } from 'ms';
import { env } from '../config/env';
import jwt from 'jsonwebtoken';
import { redisClient } from '../redis/client';
import { logger } from '../utils/logger';

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 600; // 10 minutos

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { pin: string } }>('/api/auth/login', async (req, reply) => {
    // Rate limiting por IP — máx 5 intentos fallidos en 10 min
    const ip = req.ip ?? 'unknown';
    const rateLimitKey = `auth:attempts:${ip}`;

    const attempts = await redisClient.incr(rateLimitKey);
    if (attempts === 1) {
      await redisClient.expire(rateLimitKey, WINDOW_SECONDS);
    }

    if (attempts > MAX_ATTEMPTS) {
      logger.warn({ ip, attempts }, 'Auth rate limit exceeded');
      return reply.code(429).send({ error: 'Demasiados intentos. Intenta de nuevo en 10 minutos.' });
    }

    const { pin } = req.body;
    if (pin !== env.DASHBOARD_PIN) {
      return reply.code(401).send({ error: 'PIN incorrecto' });
    }

    // Login exitoso — limpiar contador
    await redisClient.del(rateLimitKey);

    const token = jwt.sign({ role: 'admin' }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as StringValue,
    });
    return { token };
  });

  app.post<{ Body: { pin: string } }>('/api/auth/kitchen-login', async (req, reply) => {
    if (!env.KITCHEN_PIN) return reply.code(404).send({ error: 'Kitchen login not configured' });

    const ip = req.ip ?? 'unknown';
    const rateLimitKey = `auth:kitchen:attempts:${ip}`;
    const attempts = await redisClient.incr(rateLimitKey);
    if (attempts === 1) await redisClient.expire(rateLimitKey, WINDOW_SECONDS);
    if (attempts > MAX_ATTEMPTS) {
      return reply.code(429).send({ error: 'Demasiados intentos. Intenta de nuevo en 10 minutos.' });
    }

    const { pin } = req.body;
    if (pin !== env.KITCHEN_PIN) {
      return reply.code(401).send({ error: 'PIN incorrecto' });
    }

    await redisClient.del(rateLimitKey);
    const token = jwt.sign({ role: 'kitchen' }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as StringValue,
    });
    return { token };
  });
}
