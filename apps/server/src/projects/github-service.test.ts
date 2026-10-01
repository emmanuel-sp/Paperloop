import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import {
  createLocalGithubApi,
  GithubAccessError,
  GithubService,
  parseGithubRepositoryUrl,
} from './github-service.js';

const repository = {
  name: 'private-lab',
  owner: { login: 'research-team' },
  full_name: 'research-team/private-lab',
  description: 'A private research repository',
  private: true,
  default_branch: 'main',
  permissions: { pull: true },
};
const authorization = 'Bearer github-test-secret';
function appWith(api: (endpoint: string) => Promise<unknown>) {
  return createApp({
    githubApi: api,
    logger: false,
    dispatcher: false,
    connectionSecret: 'github-test-secret',
    storage: {
      dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-github-')),
    },
  });
}

describe('local GitHub credentials and fixed-host requests', () => {
  it('uses only fixed-host read commands, with bounded time and output', async () => {
    const command = vi.fn(async () => ({
      stdout: JSON.stringify({ login: 'owner' }),
    }));
    expect(await createLocalGithubApi(command)('/user')).toEqual({
      login: 'owner',
    });
    expect(command).toHaveBeenCalledWith(
      'gh',
      ['api', '--hostname', 'github.com', '--method', 'GET', '/user'],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
  });
  it.each([
    ['ENOENT', '', 'GITHUB_DISCONNECTED'],
    ['1', 'To get started, please run: gh auth login', 'GITHUB_DISCONNECTED'],
    ['1', 'Bad credentials (HTTP 401)', 'GITHUB_EXPIRED'],
    ['1', 'API rate limit exceeded (HTTP 403)', 'GITHUB_RATE_LIMITED'],
    ['1', 'Too many requests (HTTP 429)', 'GITHUB_RATE_LIMITED'],
    ['1', 'SSO authorization required (HTTP 403)', 'GITHUB_ACCESS_DENIED'],
    ['1', 'Not found (HTTP 404)', 'GITHUB_ACCESS_DENIED'],
    ['1', 'Validation failed (HTTP 422)', 'INVALID_GITHUB_SEARCH'],
    ['ETIMEDOUT', '', 'GITHUB_UNAVAILABLE'],
  ])(
    'sanitizes command failures (%s, %s)',
    async (code, diagnostic, expected) => {
      const api = createLocalGithubApi(async () => {
        throw {
          code,
          stderr: `${diagnostic}\nsecret-that-must-not-escape`,
          stdout: 'private remote data',
        };
      });
      try {
        await api('/user');
        expect.fail('Expected access error');
      } catch (error) {
        expect(error).toBeInstanceOf(GithubAccessError);
        expect(error).toMatchObject({ code: expected });
        expect(String(error)).not.toMatch(
          /secret-that-must-not-escape|private remote data/,
        );
      }
    },
  );
  it('sanitizes invalid CLI output', async () => {
    await expect(
      createLocalGithubApi(async () => ({ stdout: 'secret-not-json' }))(
        '/user',
      ),
    ).rejects.toMatchObject({ code: 'GITHUB_UNAVAILABLE' });
  });
});

describe('repository identities and authorized browsing', () => {
  it('normalizes a pasted repository URL without contacting arbitrary hosts', () => {
    expect(
      parseGithubRepositoryUrl(
        'https://github.com/research-team/private-lab.git/',
      ),
    ).toEqual({ owner: 'research-team', repository: 'private-lab' });
  });
  it.each([
    'http://github.com/owner/repo',
    'https://other.example/owner/repo',
    'https://github.com@other.example/owner/repo',
    'https://secret@github.com/owner/repo',
    'https://github.com/owner/repo/tree/main',
    'https://github.com/owner/repo?token=secret',
    'https://github.com/owner/repo#secret',
    'https://github.com/owner/%2e%2e',
    'https://github.com/owner/repo%2Fextra',
    'owner/repo',
  ])('rejects unsafe or ambiguous URLs: %s', (url) => {
    expect(() => parseGithubRepositoryUrl(url)).toThrow(GithubAccessError);
  });
  it('browses collaborator/private repositories, searches and paginates within bounds', async () => {
    const api = vi.fn(async (endpoint: string) =>
      endpoint.startsWith('/search/')
        ? { items: [repository] }
        : Array.from({ length: 30 }, () => repository),
    );
    const service = new GithubService(api);
    expect(await service.list('', 2)).toMatchObject({
      hasMore: true,
      repositories: [
        expect.objectContaining({ visibility: 'private', access: 'read' }),
        ...Array.from({ length: 29 }, () => expect.anything()),
      ],
    });
    expect(await service.list('team private', 1)).toMatchObject({
      hasMore: false,
    });
    expect(api.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      '/user/repos?sort=updated&affiliation=owner,collaborator,organization_member&per_page=30&page=2',
      '/search/repositories?q=team%20private&sort=updated&per_page=30&page=1',
    ]);
    await expect(
      new GithubService(async () => ({
        ...repository,
        permissions: { pull: false },
      })).resolve('research-team', 'private-lab'),
    ).rejects.toMatchObject({ code: 'GITHUB_ACCESS_DENIED' });
  });
});

describe('authenticated GitHub selection routes', () => {
  it('protects credentials and repository metadata with existing auth, host and origin checks', async () => {
    const api = vi.fn(async () => repository);
    const app = appWith(api);
    try {
      for (const url of [
        '/api/v1/github/connection',
        '/api/v1/github/repositories',
      ])
        expect((await app.inject({ url })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/github/repository',
            payload: { url: 'https://github.com/research-team/private-lab' },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            url: '/api/v1/github/connection',
            headers: { authorization, origin: 'https://untrusted.example' },
          })
        ).statusCode,
      ).toBe(403);
      expect(api).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('resolves private identities and rechecks access before persisting a project', async () => {
    let denied = false;
    const api = vi.fn(async (endpoint: string) => {
      if (denied)
        throw new GithubAccessError(
          'GITHUB_ACCESS_DENIED',
          'Access denied.',
          403,
        );
      return endpoint === '/user'
        ? { login: 'fixture-user' }
        : endpoint.startsWith('/user/repos')
          ? [repository]
          : repository;
    });
    const app = appWith(api);
    try {
      expect(
        (
          await app.inject({
            url: '/api/v1/github/connection',
            headers: { authorization },
          })
        ).json(),
      ).toEqual({ login: 'fixture-user' });
      const resolved = await app.inject({
        method: 'POST',
        url: '/api/v1/github/repository',
        headers: { authorization },
        payload: { url: 'https://github.com/research-team/private-lab' },
      });
      expect(resolved.json()).toMatchObject({
        fullName: 'research-team/private-lab',
        visibility: 'private',
        access: 'read',
      });
      const input = {
        name: 'Private lab',
        description: 'Research context without a checkout',
        repository: {
          kind: 'github',
          owner: 'research-team',
          repository: 'private-lab',
        },
      };
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization },
        payload: input,
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().repository).toEqual(input.repository);
      expect(JSON.stringify(created.json())).not.toMatch(
        /token|permissions|login|private research/,
      );
      denied = true;
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/projects',
            headers: { authorization },
            payload: input,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/api/v1/projects/${created.json().id}/repository`,
            headers: { authorization },
            payload: input.repository,
          })
        ).statusCode,
      ).toBe(403);
      expect(app.projects.list()).toHaveLength(1);
      expect(app.projects.listContext(created.json().id)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
  it('validates URLs, identifiers and query bounds before contacting GitHub', async () => {
    const api = vi.fn(async () => repository);
    const app = appWith(api);
    try {
      for (const url of [
        '/api/v1/github/repositories?page=0',
        '/api/v1/github/repositories?page=21',
      ])
        expect(
          (await app.inject({ url, headers: { authorization } })).statusCode,
        ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/github/repository',
            headers: { authorization },
            payload: { url: 'https://untrusted.example/owner/repo' },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/projects',
            headers: { authorization },
            payload: {
              name: 'Invalid',
              description: 'Unsafe repository',
              repository: { kind: 'github', owner: '..', repository: 'repo' },
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(api).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
