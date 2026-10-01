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
import { GithubService } from './github-service.js';

interface ProjectParameters {
  id: string;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  service: ProjectService,
  github: GithubService,
): void {
  app.get('/api/v1/projects', async () =>
    projectListResponseSchema.parse({ projects: service.list() }),
  );

  app.post('/api/v1/projects', async (request, reply) => {
    const input = createProjectRequestSchema.parse(request.body);
    if (input.repository?.kind === 'github') {
      const selected = await github.resolve(
        input.repository.owner,
        input.repository.repository,
      );
      input.repository = {
        kind: 'github',
        owner: selected.owner,
        repository: selected.repository,
      };
    }
    const project = service.create(input);
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
    async (request) => {
      service.get(request.params.id);
      let repository = projectRepositorySchema.parse(request.body);
      if (repository.kind === 'github') {
        const selected = await github.resolve(
          repository.owner,
          repository.repository,
        );
        repository = {
          kind: 'github',
          owner: selected.owner,
          repository: selected.repository,
        };
      }
      return projectSchema.parse(
        service.registerRepository(request.params.id, repository),
      );
    },
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
