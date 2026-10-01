import {
  githubConnectionSchema,
  githubRepositoryListSchema,
  githubRepositoryQuerySchema,
  githubRepositorySchema,
  githubRepositoryUrlRequestSchema,
} from '@paperloop/contracts';
import type { FastifyInstance } from 'fastify';
import { GithubService, parseGithubRepositoryUrl } from './github-service.js';

export function registerGithubRoutes(
  app: FastifyInstance,
  github: GithubService,
) {
  app.get('/api/v1/github/connection', async () =>
    githubConnectionSchema.parse(await github.connection()),
  );
  app.get('/api/v1/github/repositories', async (request) => {
    const query = githubRepositoryQuerySchema.parse(request.query);
    return githubRepositoryListSchema.parse(
      await github.list(query.query, query.page),
    );
  });
  app.post('/api/v1/github/repository', async (request) => {
    const input = githubRepositoryUrlRequestSchema.parse(request.body);
    const identity = parseGithubRepositoryUrl(input.url);
    return githubRepositorySchema.parse(
      await github.resolve(identity.owner, identity.repository),
    );
  });
}
