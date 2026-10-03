import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
const headers = { authorization: 'Bearer suggestions' };
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'paperloop-suggestion-'));
  const app = createApp({
    logger: false,
    connectionSecret: 'suggestions',
    storage: { dataDirectory: join(root, 'data') },
  });
  const project = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: {
        name: 'Measured project',
        description: 'Measure retrieval relevance',
        objectives: ['Improve grounding'],
        repository: { kind: 'local', path: root },
      },
    })
  ).json() as { id: string; currentContext: { version: number } };
  const paper = app.research.ingest(project.id, {
    title: 'Relevant research',
    sourceKind: 'reference',
    sourceReference: 'Research citation',
    authors: [],
    submittedBy: 'user',
    extractionStatus: 'unavailable',
  });
  const suggestion = () =>
    app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/evaluation-suggestion?documentId=${paper.id}`,
      headers,
    });
  const use = (contextVersion = project.currentContext.version) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/evaluation-suggestion`,
      headers,
      payload: { documentId: paper.id, contextVersion },
    });
  return { app, root, project, paper, suggestion, use };
}
describe('suggested Evaluation', () => {
  it('suggests measured test outcomes without approving or claiming research-quality measurements', async () => {
    const { app, root, paper, suggestion, use } = await fixture();
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
      );
      const result = (await suggestion()).json();
      expect(result).toMatchObject({
        documentId: paper.id,
        draft: {
          name: 'Repository test guardrail',
          metrics: [{ name: 'test_passed', guardrail: true }],
        },
        plan: null,
      });
      expect(result.limitations.join(' ')).toContain(
        'not a research-quality benchmark',
      );
      const draft = (await use()).json();
      expect(draft.approvedAt).toBeNull();
      expect((await use()).json().id).toBe(draft.id);
      const adapter = fileURLToPath(
        new URL('../../dist/evaluations/test-adapter.js', import.meta.url),
      );
      for (const status of [0, 1]) {
        execFileSync(
          process.execPath,
          [
            adapter,
            'measured.json',
            process.execPath,
            '-e',
            `process.exit(${status})`,
          ],
          { cwd: root },
        );
        expect(
          JSON.parse(readFileSync(join(root, 'measured.json'), 'utf8'))
            .metrics[0].value,
        ).toBe(status === 0 ? 1 : 0);
      }
    } finally {
      await app.close();
    }
  });
  it('validates measurement contracts, reuses exact versions, and requires new approval after changes', async () => {
    const { app, root, suggestion, use } = await fixture();
    try {
      const draft = {
        name: 'Measured quality',
        datasetIdentity: 'Fixed cases v1',
        cases: ['Case one'],
        environmentIdentity: 'Python local',
        metrics: [
          {
            name: 'score',
            unit: 'points',
            direction: 'increase',
            minimumImprovement: 1,
            maximumRegression: 0,
            minimumSamples: 1,
            guardrail: false,
          },
        ],
        command: {
          executable: 'python3',
          arguments: ['evaluate.py'],
          workingDirectory: '.',
          resultPath: 'result.json',
          timeoutMs: 60000,
          environmentReferences: [],
        },
      };
      writeFileSync(
        join(root, 'paperloop.evaluation.json'),
        JSON.stringify(draft),
      );
      expect((await suggestion()).json().draft.name).toBe('Measured quality');
      const first = (await use()).json();
      app.plans.approve(first.id, first.fingerprint);
      expect((await use()).json()).toMatchObject({
        id: first.id,
        approvedAt: expect.any(String),
      });
      draft.command.arguments = ['changed.py'];
      writeFileSync(
        join(root, 'paperloop.evaluation.json'),
        JSON.stringify(draft),
      );
      const next = (await use()).json();
      expect(next.id).not.toBe(first.id);
      expect(next.fingerprint).not.toBe(first.fingerprint);
      expect(next.approvedAt).toBeNull();
      expect((await use(99)).statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('shows evidence gaps and ignores symlinked metadata without executing code', async () => {
    const { app, root, suggestion } = await fixture();
    try {
      const external = join(tmpdir(), `paperloop-external-${Date.now()}.json`);
      writeFileSync(
        external,
        JSON.stringify({ scripts: { test: 'do-not-execute' } }),
      );
      symlinkSync(external, join(root, 'package.json'));
      expect((await suggestion()).json()).toMatchObject({
        plan: null,
        draft: null,
      });
      expect((await suggestion()).json().limitations.join(' ')).toContain(
        'No reusable Evaluation',
      );
    } finally {
      await app.close();
    }
  });
});
