import Fastify from 'fastify';
import { healthResponseSchema } from '@paperloop/contracts';

export function createApp() {
  const app = Fastify({ logger: true });

  app.get('/api/v1/health', async () =>
    healthResponseSchema.parse({ status: 'ok' }),
  );

  return app;
}
