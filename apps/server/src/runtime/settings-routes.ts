import { z } from 'zod';
import {
  workspacePreferencesSchema,
  workspaceSettingsSchema,
} from '@paperloop/contracts';
import type { FastifyInstance } from 'fastify';
import type { SettingsService } from './settings-service.js';
export function registerSettingsRoutes(
  app: FastifyInstance,
  settings: SettingsService,
) {
  app.get('/api/v1/preferences', async () => settings.preferences());
  app.post('/api/v1/preferences/initialize', async (request) =>
    settings.initialize(
      z
        .object({ timezone: workspacePreferencesSchema.shape.timezone })
        .strict()
        .parse(request.body).timezone,
    ),
  );
  app.put('/api/v1/preferences', async (request) =>
    settings.update(workspacePreferencesSchema.parse(request.body)),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/settings',
    async (request) =>
      workspaceSettingsSchema.parse(settings.details(request.params.id)),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/projects/:id/analysis/test/approve',
    async (request) => {
      const input = z
        .object({
          provider: z.enum(['openai', 'anthropic']),
          model: z.string().trim().min(1).max(200),
          requestId: z.uuid(),
          consent: z.literal(true),
        })
        .strict()
        .parse(request.body);
      return settings.test(request.params.id, input);
    },
  );
}
