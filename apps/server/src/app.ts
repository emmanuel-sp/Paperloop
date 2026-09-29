import Fastify from 'fastify';
import { healthResponseSchema } from '@paperloop/contracts';
import {
  openDatabase,
  type OpenDatabaseOptions,
} from './storage/database.js';

export interface CreateAppOptions {
  storage?: OpenDatabaseOptions;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: true });
  const database = openDatabase(options.storage);

  app.addHook('onClose', async () => {
    database.close();
  });

  app.get('/api/v1/health', async () =>
    healthResponseSchema.parse({ status: 'ok' }),
  );

  return app;
}
