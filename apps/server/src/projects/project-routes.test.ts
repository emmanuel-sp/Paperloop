import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const connectionSecret = 'project-route-test-secret';
const authorization = `Bearer ${connectionSecret}`;

function makeApp(
  dataDirectory = mkdtempSync(join(tmpdir(), 'paperloop-projects-')),
) {
  return createApp({
    githubApi: async (endpoint) => {
      const [, , owner, name] = endpoint.split('/');
      return {
        owner: { login: owner },
        name,
        full_name: `${owner}/${name}`,
        description: null,
        private: false,
        permissions: { pull: true },
      };
    },
    connectionSecret,
    logger: false,
    storage: { dataDirectory },
  });
}

describe('project HTTP API', () => {
  it('creates, lists, updates, and refreshes durable project context', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'paperloop-projects-'));
    const firstApp = makeApp(dataDirectory);
    const createdResponse = await firstApp.inject({
      headers: { authorization },
      method: 'POST',
      url: '/api/v1/projects',
      payload: {
        name: 'Retrieval service',
        description: 'Answers questions from a versioned document collection.',
        objectives: ['Improve grounded answer quality'],
        constraints: ['Keep p95 latency below 500ms'],
        repository: {
          kind: 'github',
          owner: 'example',
          repository: 'retrieval-service',
        },
      },
    });

    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created).toMatchObject({
      name: 'Retrieval service',
      repository: {
        kind: 'github',
        owner: 'example',
        repository: 'retrieval-service',
      },
      currentContext: {
        version: 1,
        sourceKind: 'github',
        sourceReference: 'https://github.com/example/retrieval-service',
        repositoryRevision: null,
      },
    });

    const updatedResponse = await firstApp.inject({
      headers: { authorization },
      method: 'PATCH',
      url: `/api/v1/projects/${created.id}`,
      payload: { objectives: ['Improve quality', 'Reduce cost'] },
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json()).toMatchObject({
      objectives: ['Improve quality', 'Reduce cost'],
      currentContext: { version: 2 },
    });

    const refreshedResponse = await firstApp.inject({
      headers: { authorization },
      method: 'POST',
      url: `/api/v1/projects/${created.id}/context/refresh`,
      payload: {
        repositoryRevision: '0123456789abcdef',
        summary: 'Context refreshed from the default branch.',
      },
    });
    expect(refreshedResponse.statusCode).toBe(200);
    expect(refreshedResponse.json()).toMatchObject({
      currentContext: {
        version: 3,
        repositoryRevision: '0123456789abcdef',
      },
    });

    const historyResponse = await firstApp.inject({
      headers: { authorization },
      method: 'GET',
      url: `/api/v1/projects/${created.id}/context`,
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(
      historyResponse
        .json()
        .contexts.map((context: { version: number }) => context.version),
    ).toEqual([3, 2, 1]);
    await firstApp.close();

    const restartedApp = makeApp(dataDirectory);
    const listResponse = await restartedApp.inject({
      headers: { authorization },
      method: 'GET',
      url: '/api/v1/projects',
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().projects).toHaveLength(1);
    expect(listResponse.json().projects[0]).toMatchObject({
      id: created.id,
      currentContext: { version: 3 },
    });
    await restartedApp.close();
  });

  it('registers an available local directory without requiring Git', async () => {
    const localDirectory = mkdtempSync(
      join(tmpdir(), 'paperloop-local-project-'),
    );
    const app = makeApp();
    const response = await app.inject({
      headers: { authorization },
      method: 'POST',
      url: '/api/v1/projects',
      payload: {
        name: 'Local prototype',
        description: 'A local prototype without a Git repository yet.',
        repository: { kind: 'local', path: localDirectory },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      repository: { kind: 'local', path: localDirectory },
      currentContext: {
        sourceKind: 'local',
        sourceReference: localDirectory,
        repositoryRevision: null,
      },
    });
    await app.close();
  });

  it('enriches a description-only project with a repository later', async () => {
    const app = makeApp();
    const created = await app.inject({
      headers: { authorization },
      method: 'POST',
      url: '/api/v1/projects',
      payload: {
        name: 'Description first',
        description: 'A project that will connect its repository after setup.',
      },
    });
    const response = await app.inject({
      headers: { authorization },
      method: 'PUT',
      url: `/api/v1/projects/${created.json().id}/repository`,
      payload: {
        kind: 'github',
        owner: 'example',
        repository: 'connected-later',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repository: {
        kind: 'github',
        owner: 'example',
        repository: 'connected-later',
      },
      currentContext: { version: 2, sourceKind: 'github' },
    });
    await app.close();
  });

  it('returns structured errors for bad input, missing projects, and paths', async () => {
    const app = makeApp();
    const invalid = await app.inject({
      headers: { authorization },
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: '', description: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const missing = await app.inject({
      headers: { authorization },
      method: 'GET',
      url: '/api/v1/projects/missing',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'PROJECT_NOT_FOUND' });

    const badPath = await app.inject({
      headers: { authorization },
      method: 'POST',
      url: '/api/v1/projects',
      payload: {
        name: 'Unavailable local project',
        description: 'This project points at a directory that does not exist.',
        repository: { kind: 'local', path: '/definitely/not/paperloop' },
      },
    });
    expect(badPath.statusCode).toBe(400);
    expect(badPath.json()).toMatchObject({ code: 'INVALID_REPOSITORY' });
    await app.close();
  });

  it('does not allow unauthenticated project access', async () => {
    const app = makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
