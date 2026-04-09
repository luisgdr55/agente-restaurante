/**
 * Creates a Fastify app instance for integration testing.
 * Does NOT start a real HTTP server — uses inject() for requests.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { authRoutes } from '../../api/auth.routes';
import { dashboardRoutes } from '../../api/dashboard.routes';

export async function createTestApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(helmet, { contentSecurityPolicy: false });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes);
  await app.register(dashboardRoutes);

  await app.ready();
  return app;
}
