import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Construir URL con connection pool aumentado (default Prisma = 5, aquí = 20)
function buildDatasourceUrl(): string {
  const base = process.env.DATABASE_URL ?? '';
  try {
    const url = new URL(base);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '20');
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '20');
    }
    return url.toString();
  } catch {
    return base; // Si la URL es inválida, Prisma la rechazará al conectar
  }
}

// Singleton para evitar múltiples instancias en desarrollo con hot-reload
export const prisma =
  global.__prisma ??
  new PrismaClient({
    datasourceUrl: buildDatasourceUrl(),
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'warn' }]
        : [],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

// Manejar errores de conexión
process.on('beforeExit', async () => {
  await prisma.$disconnect().catch(() => {
    logger.error('Failed to disconnect Prisma');
  });
});

export type { PrismaClient };
