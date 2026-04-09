import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        // En producción: JSON estructurado para ingestión por log aggregators
        formatters: {
          level(label) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

// Logger child para mensajes de WhatsApp procesados
export function createMessageLogger(phone: string) {
  return logger.child({ module: 'message', phone });
}

// Logger child para llamadas LLM
export function createLlmLogger() {
  return logger.child({ module: 'llm' });
}

export type Logger = typeof logger;
