import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  scheduleConfigSchema,
  ingestResearchDocumentRequestSchema,
  evaluationPlanDraftSchema,
  type AnalysisOutput,
} from '@paperloop/contracts';
import { createApp } from '../app.js';
import { occurrence } from './cadence.js';
import { createModelExecutor } from '../analysis/providers.js';
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const headers = { authorization: 'Bearer scheduling-test' };
const empty: AnalysisOutput = { recommendations: [], plans: [] };
function config(changes: Record<string, unknown> = {}) {
  return scheduleConfigSchema.parse({
    timezone: 'America/Los_Angeles',
    ...changes,
  });
}
function fixture(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'paperloop-schedule-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let time = new Date('2026-09-30T15:00:00Z');
  const app = createApp({
    connectionSecret: 'scheduling-test',
    logger: false,
    dispatcher: false,
    storage: { dataDirectory: directory },
    scheduleNow: () => time,
    ...options,
  });
  cleanup.push(() => app.close());
  const project = app.projects.create({
    name: 'Research cadence',
    description: 'Measure quality',
    objectives: ['quality'],
    constraints: [],
  });
  return {
    app,
    project,
    directory,
    setTime: (value: string) => {
      time = new Date(value);
    },
  };
}
function recommendation(documentId: string, version = 1) {
  return {
    documentId,
    title: 'Improve quality',
    summary: 'Technique',
    applicability: 'Relevant',
    prerequisites: [],
    uncertainty: 'Unmeasured',
    evaluationTargets: ['quality'],
    sources: [
      { documentId, claim: 'quality improves', evidence: 'paper reports it' },
    ],
    projectContextVersion: version,
  };
}
function document(app: ReturnType<typeof createApp>, projectId: string) {
  return app.research.ingest(
    projectId,
    ingestResearchDocumentRequestSchema.parse({
      title: 'Technique',
      sourceKind: 'reference',
      sourceReference: 'test',
      submittedBy: 'user',
      extractedContent: 'Evidence text',
      extractionStatus: 'complete',
    }),
  );
}
async function waitJob(app: ReturnType<typeof createApp>, id: string) {
  for (let index = 0; index < 100; index++) {
    const job = app.schedules.job(id);
    if (['completed', 'failed', 'interrupted'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Job did not settle');
}
describe('durable scheduling and native claims', () => {
  it('uses local daily/weekly time, skips missing DST time, and coalesces repeated DST time', () => {
    expect(occurrence(config(), new Date('2026-09-30T15:00:00Z'), 1)).toBe(
      '2026-09-30T16:00:00.000Z',
    );
    expect(
      occurrence(
        config({ cadence: 'weekly', weekday: 1 }),
        new Date('2026-09-30T15:00:00Z'),
        1,
      ),
    ).toBe('2026-10-05T16:00:00.000Z');
    expect(
      occurrence(
        config({ hour: 2, minute: 30 }),
        new Date('2026-03-08T09:59:00Z'),
        1,
      ),
    ).toBe('2026-03-09T09:30:00.000Z');
    expect(
      occurrence(
        config({ hour: 1, minute: 30 }),
        new Date('2026-11-01T08:30:00Z'),
        1,
      ),
    ).toBe('2026-11-02T09:30:00.000Z');
    expect(
      occurrence(
        config({ hour: 1, minute: 30 }),
        new Date('2026-11-01T09:40:00Z'),
        -1,
      ),
    ).toBe('2026-11-01T08:30:00.000Z');
  });
  it('persists cadence, reports setup separately, creates only one catch-up job, and rejects stale/paused callbacks', () => {
    const { app, project, setTime } = fixture();
    const schedule = app.schedules.create(project.id, config()).schedule;
    expect(schedule.setup).toBe('pending');
    expect(
      app.schedules.checkIn(
        schedule.id,
        1,
        undefined,
        'failed',
        'Desktop unavailable',
      ).schedule,
    ).toMatchObject({
      setup: 'failed',
      setupError: 'Desktop unavailable',
      lastCheckIn: null,
    });
    expect(schedule.lastCheckIn).toBeNull();
    expect(
      app.schedules.checkIn(schedule.id, 1, 'native-task').schedule,
    ).toMatchObject({ setup: 'reported', lastCheckIn: null });
    setTime('2026-10-10T19:00:00Z');
    app.schedules.tick();
    app.schedules.tick();
    expect(app.schedules.list(project.id).jobs).toHaveLength(1);
    expect(app.schedules.due(schedule.id, 1).jobs[0]).toMatchObject({
      occurrence: '2026-10-10T16:00:00.000Z',
      status: 'waiting_for_agent',
    });
    expect(app.schedules.get(schedule.id).lastCheckIn).toBe(
      '2026-10-10T19:00:00.000Z',
    );
    const paused = app.schedules.setState(schedule.id, 'paused').schedule;
    expect(() => app.schedules.due(schedule.id, 1)).toThrow(/revision/);
    expect(() => app.schedules.due(schedule.id, paused.revision)).toThrow(
      /paused/,
    );
    expect(app.schedules.list(project.id).jobs[0]?.status).toBe('cancelled');
    expect(
      app.schedules.checkIn(schedule.id, paused.revision, 'native-task')
        .schedule.setup,
    ).toBe('reported');
    const removed = app.schedules.setState(schedule.id, 'removed').schedule;
    expect(() => app.schedules.due(schedule.id, removed.revision)).toThrow(
      /removed/,
    );
  });
  it('deduplicates manual requests and uses one token across concurrent claim attempts and batch rollback', async () => {
    const { app, project } = fixture();
    const schedule = app.schedules.create(project.id, config()).schedule;
    const requestId = crypto.randomUUID();
    const job = app.schedules.scanNow(schedule.id, requestId);
    expect(app.schedules.scanNow(schedule.id, requestId).id).toBe(job.id);
    const paper = document(app, project.id);
    vi.spyOn(app.discovery, 'search').mockResolvedValue({
      id: crypto.randomUUID(),
      projectId: project.id,
      query: '',
      createdAt: new Date().toISOString(),
      documentIds: [paper.id],
      outcomes: [],
      analysisStatus: 'waiting_for_agent',
    });
    const claims = await Promise.allSettled([
      app.schedules.claim(job.id, 1, 'agent-one'),
      app.schedules.claim(job.id, 1, 'agent-two'),
    ]);
    expect(claims.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const second = app.research.ingest(
      project.id,
      ingestResearchDocumentRequestSchema.parse({
        title: 'Second',
        sourceKind: 'reference',
        sourceReference: 'second',
        submittedBy: 'user',
        extractedContent: 'Other evidence',
        extractionStatus: 'complete',
      }),
    );
    const row = app.schedules.job(job.id);
    app.database.sqlite
      .prepare('UPDATE schedule_jobs SET payload=? WHERE id=?')
      .run(
        JSON.stringify({ ...row, documentIds: [paper.id, second.id] }),
        job.id,
      );
    const owned = app.schedules.job(job.id);
    const token = owned.token!;
    expect(() =>
      app.schedules.submit(job.id, crypto.randomUUID(), empty),
    ).toThrow(/ownership/);
    expect(() =>
      app.schedules.submit(job.id, token, {
        recommendations: [
          recommendation(paper.id),
          recommendation(second.id, 2),
        ],
        plans: [],
      }),
    ).toThrow(/context/);
    expect(app.discovery.recommendations(project.id)).toHaveLength(0);
    app.schedules.heartbeat(job.id, token, 'Reviewed research');
    app.schedules.submit(job.id, token, {
      recommendations: [recommendation(paper.id)],
      plans: [],
    });
    expect(app.discovery.recommendations(project.id)).toHaveLength(1);
    expect(() => app.schedules.submit(job.id, token, empty)).toThrow(
      /ownership/,
    );
  });
  it('preserves queued work on restart and interrupts claimed work without switching providers', async () => {
    const { app, project, directory } = fixture();
    const schedule = app.schedules.create(project.id, config()).schedule;
    const job = app.schedules.scanNow(schedule.id, crypto.randomUUID());
    await app.schedules.claim(job.id, 1, 'agent');
    const waiting = app.schedules.scanNow(schedule.id, crypto.randomUUID());
    await app.close();
    const restarted = createApp({
      connectionSecret: 'scheduling-test',
      logger: false,
      dispatcher: false,
      storage: { dataDirectory: directory },
    });
    cleanup.push(() => restarted.close());
    expect(restarted.schedules.get(schedule.id).config).toEqual(
      schedule.config,
    );
    expect(restarted.schedules.job(job.id)).toMatchObject({
      status: 'interrupted',
      token: null,
      attempt: 1,
    });
    expect(restarted.schedules.job(waiting.id).status).toBe(
      'waiting_for_agent',
    );
    expect(
      restarted.schedules.reconcile(
        job.id,
        'Inspected outputs; no completion was applied.',
      ).status,
    ).toBe('waiting_for_agent');
  });
  it('expires claims, bounds reconciliation attempts, and never retries a changed schedule', async () => {
    const { app, project, setTime } = fixture();
    const schedule = app.schedules.create(project.id, config()).schedule;
    const job = app.schedules.scanNow(schedule.id, crypto.randomUUID());
    for (let attempt = 0; attempt < 3; attempt++) {
      await app.schedules.claim(job.id, 1, 'agent');
      setTime(
        `2026-09-30T15:${String((attempt + 1) * 10).padStart(2, '0')}:00Z`,
      );
      app.schedules.tick();
      expect(app.schedules.job(job.id).status).toBe('interrupted');
      if (attempt < 2)
        app.schedules.reconcile(job.id, 'Inspected prior attempt');
    }
    expect(() =>
      app.schedules.reconcile(job.id, 'Inspect final attempt'),
    ).toThrow(/Three attempts/);
    app.schedules.update(schedule.id, config({ cadence: 'weekly' }));
    expect(
      app.schedules.reconcile(
        job.id,
        'Inspected old revision; no output remains.',
      ).status,
    ).toBe('cancelled');
  });
  it('enforces browser-only API and rule approvals through HTTP', async () => {
    const { app, project } = fixture({ settingsEnvironment: { OPENAI_API_KEY: 'fixture-key' }, probeExecutor: async () => ({ inputTokens: 4, outputTokens: 1 }) });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${project.id}/analysis/approve`,
          headers,
          payload: {
            enabled: true,
            provider: 'openai',
            model: 'fixture-model',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${project.id}/automation/approve`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers,
    });
    const cookie = String(session.headers['set-cookie']).split(';')[0]!;
    await app.inject({ method: 'POST', url: `/api/v1/projects/${project.id}/analysis/test/approve`, headers: { cookie }, payload: { requestId: crypto.randomUUID(), provider: 'openai', model: 'fixture-model', consent: true } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${project.id}/analysis/approve`,
          headers: { cookie },
          payload: {
            enabled: true,
            provider: 'openai',
            model: 'fixture-model',
          },
        })
      ).statusCode,
    ).toBe(200);
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/schedules`,
      headers,
      payload: config(),
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().schedule.setup).toBe('pending');
  });
  it('shares occurrences and pause enforcement with a real MCP client', async () => {
    const { app, project } = fixture();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing address');
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers } },
    );
    const client = new Client({ name: 'schedule-test', version: '1' });
    await client.connect(transport as unknown as Transport);
    cleanup.push(() => client.close());
    const created = await client.callTool({
      name: 'schedules_create',
      arguments: { projectId: project.id, config: config() },
    });
    const schedule = (created.structuredContent as { schedule: { id: string } })
      .schedule;
    const queued = await client.callTool({
      name: 'schedules_scan_now',
      arguments: { scheduleId: schedule.id, requestId: crypto.randomUUID() },
    });
    expect((queued.structuredContent as { status: string }).status).toBe(
      'waiting_for_agent',
    );
    app.schedules.setState(schedule.id, 'paused');
    const stale = await client.callTool({
      name: 'schedules_due',
      arguments: { scheduleId: schedule.id, revision: 1 },
    });
    expect(stale.isError).toBe(true);
    expect(
      (await client.listTools()).tools.some(
        (tool) => tool.name === 'schedules_approve',
      ),
    ).toBe(false);
  });
});
describe('opt-in model analysis', () => {
  it('key configuration alone starts nothing and disabled projects cannot queue API schedules', async () => {
    const executor = vi.fn().mockResolvedValue(empty);
    const { app, project, setTime } = fixture({ modelExecutor: executor });
    app.schedules.create(project.id, config());
    setTime('2026-10-01T20:00:00Z');
    app.schedules.tick();
    expect(executor).not.toHaveBeenCalled();
    expect(() =>
      app.schedules.create(project.id, config({ driver: 'api' })),
    ).toThrow(/Enable/);
    app.analysis.activate(project.id, {
      enabled: true,
      provider: 'openai',
      model: 'explicit-model',
    });
    app.schedules.tick();
    expect(executor).not.toHaveBeenCalled();
  });
  it('runs selected API analysis once, validates context and stores draft-only outputs', async () => {
    const executor = vi.fn().mockResolvedValue(empty);
    const { app, project } = fixture({ modelExecutor: executor });
    const paper = document(app, project.id);
    executor.mockResolvedValue({
      recommendations: [recommendation(paper.id)],
      plans: [],
    });
    vi.spyOn(app.discovery, 'search').mockResolvedValue({
      id: crypto.randomUUID(),
      projectId: project.id,
      query: '',
      createdAt: new Date().toISOString(),
      documentIds: [paper.id],
      outcomes: [],
      analysisStatus: 'waiting_for_agent',
    });
    app.analysis.activate(project.id, {
      enabled: true,
      provider: 'anthropic',
      model: 'user-model',
    });
    const schedule = app.schedules.create(
      project.id,
      config({ driver: 'api', provider: 'anthropic' }),
    ).schedule;
    const requestId = crypto.randomUUID();
    const job = app.schedules.scanNow(schedule.id, requestId);
    expect((await waitJob(app, job.id)).status).toBe('completed');
    app.schedules.scanNow(schedule.id, requestId);
    app.schedules.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[0]).toMatchObject({
      provider: 'anthropic',
      model: 'user-model',
    });
    expect(app.discovery.recommendations(project.id)).toHaveLength(1);
    expect(app.experiments.list(project.id)).toHaveLength(0);
    const repeated = app.schedules.scanNow(schedule.id, crypto.randomUUID());
    expect((await waitJob(app, repeated.id)).status).toBe('completed');
    expect(executor).toHaveBeenCalledTimes(1);
  });
  it('does not retry paid failures or silently change provider and cancels changed in-flight work', async () => {
    const executor = vi
      .fn()
      .mockRejectedValue(new Error('sensitive provider diagnostic'));
    const { app, project } = fixture({ modelExecutor: executor });
    const paper = document(app, project.id);
    vi.spyOn(app.discovery, 'search').mockResolvedValue({
      id: crypto.randomUUID(),
      projectId: project.id,
      query: '',
      createdAt: new Date().toISOString(),
      documentIds: [paper.id],
      outcomes: [],
      analysisStatus: 'waiting_for_agent',
    });
    app.analysis.activate(project.id, {
      enabled: true,
      provider: 'openai',
      model: 'chosen',
    });
    const schedule = app.schedules.create(
      project.id,
      config({ driver: 'api' }),
    ).schedule;
    const job = app.schedules.scanNow(schedule.id, crypto.randomUUID());
    expect(await waitJob(app, job.id)).toMatchObject({
      status: 'failed',
      attempt: 1,
    });
    app.schedules.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(app.schedules.job(job.id).error).not.toContain('sensitive');
    executor.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const next = app.schedules.scanNow(schedule.id, crypto.randomUUID());
    for (let n = 0; n < 100 && executor.mock.calls.length < 2; n++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    app.schedules.setState(schedule.id, 'paused');
    expect((await waitJob(app, next.id)).status).toBe('interrupted');
    expect(app.discovery.recommendations(project.id)).toHaveLength(0);
  });
  it('bounds transient research retries before paid dispatch', async () => {
    const executor = vi.fn();
    const { app, project, setTime } = fixture({ modelExecutor: executor });
    vi.spyOn(app.discovery, 'search').mockImplementation(async () => ({
      id: crypto.randomUUID(),
      projectId: project.id,
      query: '',
      createdAt: new Date().toISOString(),
      documentIds: [],
      outcomes: [
        {
          sourceId: 'fixture',
          status: 'failed',
          coverage: 'fixture',
          count: 0,
          nextOffset: null,
          retryAt: null,
          error: 'offline',
        },
      ],
      analysisStatus: 'complete',
    }));
    app.analysis.activate(project.id, {
      enabled: true,
      provider: 'openai',
      model: 'chosen',
    });
    const schedule = app.schedules.create(
      project.id,
      config({ driver: 'api' }),
    ).schedule;
    const job = app.schedules.scanNow(schedule.id, crypto.randomUUID());
    for (let attempt = 1; attempt <= 3; attempt++) {
      for (
        let n = 0;
        n < 100 && app.schedules.job(job.id).status === 'running';
        n++
      )
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(app.schedules.job(job.id).attempt).toBe(attempt);
      if (attempt < 3) {
        expect(app.schedules.job(job.id).status).toBe('pending');
        app.schedules.scanNow(
          schedule.id,
          job.occurrence.slice('manual:'.length),
        );
        expect(app.schedules.job(job.id).attempt).toBe(attempt);
        setTime(`2026-09-30T${15 + attempt}:00:00Z`);
        app.schedules.tick();
      }
    }
    expect(app.schedules.job(job.id).status).toBe('failed');
    expect(executor).not.toHaveBeenCalled();
  });
  it('adapters parse actual Responses/Messages shapes and suppress secrets in provider errors', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const executor = createModelExecutor(
      {
        OPENAI_API_KEY: 'fixture-openai-secret',
        ANTHROPIC_API_KEY: 'fixture-anthropic-secret',
      },
      fetcher,
    );
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { content: [{ type: 'output_text', text: JSON.stringify(empty) }] },
          ],
        }),
        { status: 200 },
      ),
    );
    expect(
      await executor({
        provider: 'openai',
        model: 'configured',
        context: {},
        signal: AbortSignal.timeout(1000),
      }),
    ).toEqual(empty);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'configured',
      store: false,
      text: { format: { type: 'json_object' } },
    });
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', name: 'submit_analysis', input: empty },
          ],
        }),
        { status: 200 },
      ),
    );
    expect(
      await executor({
        provider: 'anthropic',
        model: 'configured',
        context: {},
        signal: AbortSignal.timeout(1000),
      }),
    ).toEqual(empty);
    fetcher.mockResolvedValueOnce(
      new Response('fixture-anthropic-secret provider error', { status: 429 }),
    );
    await expect(
      executor({
        provider: 'anthropic',
        model: 'configured',
        context: {},
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow('HTTP 429');
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'incomplete', output: [] })),
    );
    await expect(
      executor({
        provider: 'openai',
        model: 'configured',
        context: {},
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow(/invalid/);
  });
});
describe('automation prerequisites and budgets', () => {
  function plan() {
    return evaluationPlanDraftSchema.parse({
      name: 'Quality',
      datasetIdentity: 'fixture-v1',
      cases: ['one'],
      metrics: [
        {
          name: 'quality',
          unit: 'score',
          direction: 'increase',
          minimumImprovement: 1,
          maximumRegression: 0,
          minimumSamples: 1,
          guardrail: false,
        },
      ],
      command: {
        executable: process.execPath,
        arguments: [
          '-e',
          `require('fs').writeFileSync('result.json',JSON.stringify({schemaVersion:1,metrics:[{name:'quality',value:1,unit:'score'}],artifacts:[]}))`,
        ],
        resultPath: 'result.json',
        timeoutMs: 5000,
      },
      environmentIdentity: 'local',
    });
  }
  it('requires exact approvals, goal/category and project ownership, deduplicates experiments and enforces run limits through common services', async () => {
    const { app, project, directory } = fixture();
    const repository = join(directory, 'repository');
    mkdirSync(repository);
    writeFileSync(join(repository, 'README.md'), 'fixture');
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
    git('init');
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-m',
      'fixture',
    );
    app.projects.registerRepository(project.id, {
      kind: 'local',
      path: repository,
    });
    const paper = document(app, project.id);
    const recommendationRow = app.discovery.storeRecommendation(
      project.id,
      recommendation(
        paper.id,
        app.projects.get(project.id).currentContext.version,
      ),
    );
    const draft = app.plans.draft(project.id, plan());
    const rule = {
      enabled: true,
      goals: ['quality'],
      categories: ['retrieval'],
      planId: draft.id,
      maxExperiments: 1,
      maxRuns: 2,
    };
    expect(() => app.schedules.approveRule(project.id, rule)).toThrow(
      /Approve/,
    );
    app.plans.approve(draft.id, draft.fingerprint);
    app.schedules.approveRule(project.id, rule);
    const input = {
      recommendationId: recommendationRow.id,
      goal: 'quality',
      category: 'retrieval',
      experiment: { documentId: paper.id, planId: draft.id },
    };
    expect(() =>
      app.schedules.automate(project.id, { ...input, category: 'unapproved' }),
    ).toThrow(/Goal/);
    const detail = app.schedules.automate(project.id, input);
    expect(detail.experiment.status).toBe('pending');
    expect(app.schedules.automate(project.id, input).experiment.id).toBe(
      detail.experiment.id,
    );
    app.schedules.approveRule(project.id, { ...rule, enabled: false });
    expect(() => app.experiments.claim(detail.experiment.id, 'agent')).toThrow(
      /no longer authorizes/,
    );
    app.schedules.approveRule(project.id, {
      ...rule,
      categories: ['different'],
    });
    expect(() => app.experiments.claim(detail.experiment.id, 'agent')).toThrow(
      /no longer authorizes/,
    );
    app.schedules.approveRule(project.id, rule);
    const claimed = app.experiments.claim(detail.experiment.id, 'agent');
    app.schedules.approveRule(project.id, { ...rule, goals: ['different'] });
    expect(() =>
      app.experiments.progress(
        detail.experiment.id,
        claimed.experiment.claimToken!,
        'ready',
        true,
      ),
    ).toThrow(/no longer authorizes/);
    app.schedules.approveRule(project.id, rule);
    app.experiments.progress(
      detail.experiment.id,
      claimed.experiment.claimToken!,
      'ready',
      true,
    );
    const baseline = app.experiments.startRun(detail.experiment.id, 'baseline');
    for (
      let n = 0;
      n < 100 && app.experiments.run(baseline.id).status === 'running';
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.experiments.run(baseline.id).status).toBe('completed');
    app.experiments.importResult(
      detail.experiment.id,
      'candidate',
      'agent',
      'candidate',
      {
        schemaVersion: 1,
        metrics: [{ name: 'quality', value: 2, unit: 'score' }],
        artifacts: [],
      },
    );
    expect(() =>
      app.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/budget/);
    expect(() =>
      app.experiments.importResult(
        detail.experiment.id,
        'candidate',
        'agent',
        'candidate',
        {
          schemaVersion: 1,
          metrics: [{ name: 'quality', value: 2, unit: 'score' }],
          artifacts: [],
        },
      ),
    ).toThrow(/budget/);
    app.schedules.approveRule(project.id, { ...rule, enabled: false });
    expect(() => app.schedules.automate(project.id, input)).toThrow(/enabled/);
  });
  it('reserves automation before workspace preparation and requires inspection after a failed attempt', () => {
    const { app, project } = fixture();
    const paper = document(app, project.id);
    const rec = app.discovery.storeRecommendation(
      project.id,
      recommendation(paper.id),
    );
    const draft = app.plans.draft(project.id, plan());
    app.plans.approve(draft.id, draft.fingerprint);
    app.schedules.approveRule(project.id, {
      enabled: true,
      goals: ['quality'],
      categories: ['retrieval'],
      planId: draft.id,
      maxExperiments: 2,
      maxRuns: 2,
    });
    const input = {
      recommendationId: rec.id,
      goal: 'quality',
      category: 'retrieval',
      experiment: { documentId: paper.id, planId: draft.id },
    };
    vi.spyOn(app.experiments, 'create').mockImplementation(() => {
      expect(app.database.sqlite.inTransaction).toBe(false);
      throw new Error('workspace failure');
    });
    expect(() => app.schedules.automate(project.id, input)).toThrow(
      'workspace failure',
    );
    expect(app.schedules.rule(project.id)).toMatchObject({
      usedExperiments: 1,
      reservations: [{ state: 'interrupted' }],
    });
    expect(() => app.schedules.automate(project.id, input)).toThrow(
      /reconcile/,
    );
    app.schedules.reconcileAutomation(
      project.id,
      rec.id,
      'Inspected reserved workspace; no implementation exists.',
    );
    expect(() => app.schedules.automate(project.id, input)).toThrow(
      'workspace failure',
    );
    expect(app.schedules.rule(project.id).usedExperiments).toBe(2);
    app.schedules.reconcileAutomation(
      project.id,
      rec.id,
      'Inspected the second workspace.',
    );
    expect(() => app.schedules.automate(project.id, input)).toThrow(
      /count reached/,
    );
  });
  it('migrates real v5 databases with backup while retaining discovery records', () => {
    const root = mkdtempSync(join(tmpdir(), 'paperloop-v5-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const folder = join(root, 'migrations');
    mkdirSync(join(folder, 'meta'), { recursive: true });
    const source = resolve('drizzle');
    const journal = JSON.parse(
      readFileSync(join(source, 'meta/_journal.json'), 'utf8'),
    );
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 5,
    );
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(
        join(source, `${entry.tag}.sql`),
        join(folder, `${entry.tag}.sql`),
      );
    const old = new Database(join(root, 'paperloop.sqlite'));
    migrate(drizzle(old), { migrationsFolder: folder });
    expect(old.pragma('user_version', { simple: true })).toBe(5);
    old
      .prepare('INSERT INTO app_state(key,value,updated_at) VALUES(?,?,?)')
      .run('fixture', 'retained', Date.now());
    old.close();
    const app = createApp({
      logger: false,
      dispatcher: false,
      storage: { dataDirectory: root },
    });
    cleanup.push(() => app.close());
    expect(app.database.sqlite.pragma('user_version', { simple: true })).toBe(
      6,
    );
    expect(app.database.backupPath).toBeTruthy();
    const backup = new Database(app.database.backupPath!);
    expect(backup.pragma('user_version', { simple: true })).toBe(5);
    backup.close();
    expect(
      app.database.sqlite
        .prepare('SELECT value FROM app_state WHERE key=?')
        .get('fixture'),
    ).toEqual({ value: 'retained' });
  });
});
