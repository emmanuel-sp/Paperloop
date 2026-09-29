import {
  createProjectRequestSchema,
  projectContextListResponseSchema,
  projectListResponseSchema,
  projectRepositorySchema,
  projectSchema,
  refreshProjectContextRequestSchema,
  updateProjectRequestSchema,
} from '@paperloop/contracts';
import type { FastifyInstance } from 'fastify';
import { ProjectService } from './project-service.js';

interface ProjectParameters {
  id: string;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  service: ProjectService,
): void {
  app.get('/api/v1/projects', async () =>
    projectListResponseSchema.parse({ projects: service.list() }),
  );

  app.post('/api/v1/projects', async (request, reply) => {
    const project = service.create(createProjectRequestSchema.parse(request.body));
    return reply.code(201).send(projectSchema.parse(project));
  });

  app.get<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id',
    async (request) => projectSchema.parse(service.get(request.params.id)),
  );

  app.patch<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id',
    async (request) =>
      projectSchema.parse(
        service.update(
          request.params.id,
          updateProjectRequestSchema.parse(request.body),
        ),
      ),
  );

  app.put<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id/repository',
    async (request) =>
      projectSchema.parse(
        service.registerRepository(
          request.params.id,
          projectRepositorySchema.parse(request.body),
        ),
      ),
  );

  app.get<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id/context',
    async (request) =>
      projectContextListResponseSchema.parse({
        contexts: service.listContext(request.params.id),
      }),
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id/context/refresh',
    async (request) =>
      projectSchema.parse(
        service.refreshContext(
          request.params.id,
          refreshProjectContextRequestSchema.parse(request.body ?? {}),
        ),
      ),
  );
}
