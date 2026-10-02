import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { GithubAccessError, GithubService } from './github-service.js';
import { OnboardingService } from './onboarding-service.js';

const directory = () => mkdtempSync(join(tmpdir(), 'paperloop-onboarding-'));
const headers = { authorization: 'Bearer onboarding-fixture' };
function fixture() {
  const root = directory();
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      description: 'Improve document retrieval.',
      scripts: { test: 'touch SHOULD_NOT_EXIST', start: 'node app.js' },
      engines: { node: '>=24' },
    }),
  );
  writeFileSync(
    join(root, 'README.md'),
    '# Retrieval\n\nMeasure relevant answers.\n\n## Objectives\n- Improve grounding\n\n## Constraints\n- Keep runtime local\n',
  );
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync(
    'git',
    [
      '-C',
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'fixture',
    ],
    { stdio: 'ignore' },
  );
  return root;
}
function makeApp(data = directory()) {
  return createApp({
    connectionSecret: 'onboarding-fixture',
    storage: { dataDirectory: data },
    logger: false,
    dispatcher: false,
  });
}

describe('bounded onboarding context', () => {
  it('infers metadata, preserves user corrections/provenance across restart, and never runs scripts or approves plans', async () => {
    const root = fixture();
    const data = directory();
    let app = makeApp(data);
    try {
      const repository = { kind: 'local', path: root };
      const inspected = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/onboarding',
        headers,
        payload: { name: 'Retrieval', repository },
      });
      expect(inspected.statusCode).toBe(200);
      const preview = inspected.json();
      expect(preview).toMatchObject({
        description: 'Improve document retrieval.',
        objectives: ['Improve grounding'],
        constraints: ['Keep runtime local', 'Node.js >=24 (package metadata)'],
        inference: {
          researchDirection: 'Improve grounding',
          evaluationCapabilities: [
            { name: 'Package script: test', source: 'package.json' },
          ],
        },
      });
      expect(preview.inference.repositoryRevision).toMatch(/^[a-f0-9]{40}$/);
      expect(preview.inference.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers,
        payload: {
          name: 'Retrieval',
          repository,
          contextPreviewId: preview.id,
          description: 'Corrected project purpose.',
          objectives: preview.objectives,
          constraints: preview.constraints,
          researchDirection: 'Reduce irrelevant passages',
        },
      });
      expect(created.statusCode).toBe(201);
      const project = created.json();
      expect(project.currentContext.inference.correctedFields).toEqual([
        'description',
        'researchDirection',
      ]);
      expect(app.plans.list(project.id)).toEqual([]);
      expect(
        (await import('node:fs')).existsSync(join(root, 'SHOULD_NOT_EXIST')),
      ).toBe(false);
      await app.close();
      app = makeApp(data);
      expect(app.projects.get(project.id)).toEqual(project);
      expect(
        app.projects.listContext(project.id)[0]?.inference?.researchDirection,
      ).toBe('Reduce irrelevant passages');
    } finally {
      await app.close();
    }
  });

  it('does not read symlinks, oversized files or secret filenames and tolerates malformed metadata', async () => {
    const root = directory();
    const outside = join(directory(), 'private');
    writeFileSync(outside, 'SECRET_OUTSIDE');
    symlinkSync(outside, join(root, 'README.md'));
    writeFileSync(join(root, '.env'), 'SECRET_ENV');
    writeFileSync(join(root, 'package.json'), '{invalid');
    writeFileSync(join(root, 'pyproject.toml'), 'x'.repeat(40_000));
    const service = new OnboardingService(new GithubService());
    const preview = await service.preview({ kind: 'local', path: root });
    expect(preview.description).toBe('');
    expect(preview.inference.files.map((file) => file.path)).toEqual([
      'package.json',
    ]);
    expect(JSON.stringify(preview)).not.toContain('SECRET');
    expect(preview.inference.uncertainty.join(' ')).toContain('unreadable');
  });

  it('authenticates inspection, rejects invalid paths and prevents forged or mismatched provenance', async () => {
    const app = makeApp();
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/projects/onboarding',
            payload: {
              name: 'Private',
              repository: { kind: 'local', path: fixture() },
            },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/projects/onboarding',
            headers,
            payload: {
              name: 'Bad',
              repository: { kind: 'local', path: '/definitely/missing' },
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/projects/onboarding',
            headers,
            payload: { name: 'Bad', repository: { kind: 'local', path: '.' } },
          })
        ).statusCode,
      ).toBe(400);
      const preview = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/onboarding',
        headers,
        payload: { name: 'No repository' },
      });
      expect(preview.json().description).toBe('');
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers,
        payload: {
          name: 'Wrong',
          description: 'Manual context',
          contextPreviewId: preview.json().id,
          repository: { kind: 'local', path: directory() },
        },
      });
      expect(wrong.statusCode).toBe(409);
      expect(app.projects.list()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('expires preview identities without pretending user text is inferred', async () => {
    const service = new OnboardingService(new GithubService());
    const preview = await service.preview();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 16 * 60_000);
      expect(() =>
        service.read({
          name: 'Manual',
          description: 'Context',
          objectives: [],
          constraints: [],
          contextPreviewId: preview.id,
        }),
      ).toThrow(/expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins GitHub files to the captured commit and revalidates access before persistence', async () => {
    const calls: string[] = [];
    let revoked = false;
    const app = createApp({
      connectionSecret: 'onboarding-fixture',
      logger: false,
      dispatcher: false,
      storage: { dataDirectory: directory() },
      githubApi: async (endpoint) => {
        calls.push(endpoint);
        if (revoked)
          throw new GithubAccessError(
            'GITHUB_ACCESS_DENIED',
            'Cannot read repository.',
            403,
          );
        if (endpoint.includes('/commits/')) return { sha: 'b'.repeat(40) };
        if (endpoint.includes('/contents/package.json?')) {
          const content = JSON.stringify({
            description: 'Private research library.',
            scripts: { bench: 'never execute' },
          });
          return {
            path: 'package.json',
            type: 'file',
            encoding: 'base64',
            content: Buffer.from(content).toString('base64'),
            size: content.length,
          };
        }
        if (endpoint.includes('/contents/'))
          throw new Error('Unavailable file');
        return {
          owner: { login: 'owner' },
          name: 'lab',
          full_name: 'owner/lab',
          description: 'Metadata fallback',
          private: true,
          default_branch: 'main',
          permissions: { pull: true },
        };
      },
    });
    try {
      const repository = { kind: 'github', owner: 'owner', repository: 'lab' };
      const inspected = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/onboarding',
        headers,
        payload: { name: 'Lab', repository },
      });
      const preview = inspected.json();
      expect(preview.description).toBe('Private research library.');
      expect(
        calls
          .filter((call) => call.includes('/contents/'))
          .every((call) => call.endsWith(`?ref=${'b'.repeat(40)}`)),
      ).toBe(true);
      revoked = true;
      const saved = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers,
        payload: {
          name: 'Lab',
          description: preview.description,
          contextPreviewId: preview.id,
          repository,
        },
      });
      expect(saved.statusCode).toBe(403);
      expect(app.projects.list()).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
