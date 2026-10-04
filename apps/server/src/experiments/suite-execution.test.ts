import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  evaluationSuiteDraftSchema,
  runSchema,
  suiteCheckListSchema,
  workspaceObservationSchema,
} from '@paperloop/contracts';
import { createApp } from '../app.js';
import {
  appState,
  automationExperiments,
  automationRules,
  evaluationPlans,
  evaluationRuns,
} from '../storage/schema.js';
import * as groups from '../evaluations/process-group.js';
import {
  observationScope,
  observeWorkspace,
} from '../evaluations/workspace-observation.js';

const secret = 'suite-experiment-fixture';
const headers = { authorization: `Bearer ${secret}` };
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
function exitCheck(id: string, script = '', timeoutMs = 2000) {
  return {
    id,
    name: id,
    group: 'Validation',
    required: true,
    command: {
      executable: process.execPath,
      arguments: ['-e', script],
      timeoutMs,
    },
    report: { adapter: 'exit-code', adapterVersion: 1 },
  };
}
function fixture(checks?: unknown[], overallTimeoutMs = 15000) {
  const root = mkdtempSync(join(tmpdir(), 'paperloop-suite-experiment-'));
  const repository = join(root, 'repository'),
    dataDirectory = join(root, 'data');
  mkdirSync(repository);
  writeFileSync(
    join(repository, 'model.cjs'),
    'module.exports=value=>2*value+1;',
  );
  writeFileSync(
    join(repository, 'package-lock.json'),
    '{"lockfileVersion":3,"packages":{}}',
  );
  writeFileSync(
    join(repository, 'existing.test.cjs'),
    "const test=require('node:test'),assert=require('node:assert/strict'),predict=require('./model.cjs');for(let i=0;i<301;i++)test('repository case '+i,()=>assert.ok(Number.isFinite(predict(i))));",
  );
  writeFileSync(
    join(repository, 'benchmark.cjs'),
    "const fs=require('node:fs'),predict=require('./model.cjs');const cases=Array.from({length:301},(_,i)=>({id:'sample-'+i,label:'Measured sample '+i,status:'passed',metrics:[{name:'error',unit:'n',value:Math.abs(predict(i)-2*i)}]}));const samples=cases.map(c=>c.metrics[0].value);fs.writeFileSync('metrics.json',JSON.stringify({schemaVersion:1,metrics:[{name:'error',unit:'n',value:samples.reduce((a,b)=>a+b,0)/samples.length,samples}],artifacts:[]}));fs.writeFileSync('cases.json',JSON.stringify({schemaVersion:1,datasetIdentity:'fixture-301',cases}));",
  );
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe' });
  git('init');
  git('add', '.');
  git(
    '-c',
    'user.name=Suite Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'fixture',
  );
  // Preserve dirty original content; experiment worktrees start at committed HEAD.
  writeFileSync(join(repository, 'model.cjs'), 'module.exports=value=>99;');
  let app = createApp({
    logger: false,
    connectionSecret: secret,
    dispatcher: false,
    storage: { dataDirectory },
  });
  cleanups.push(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const project = app.projects.create({
    name: 'Suite execution',
    description: 'Reuse repository tests',
    objectives: [],
    constraints: [],
    repository: { kind: 'local', path: repository },
  });
  const paper = app.research.ingest(project.id, {
    title: 'Technique',
    sourceKind: 'reference',
    sourceReference: 'fixture',
    extractionStatus: 'unavailable',
    authors: [],
    submittedBy: 'user',
  });
  const configuration = evaluationSuiteDraftSchema.parse({
    formatVersion: 2,
    name: 'Existing project checks',
    datasetIdentity: 'fixture-301',
    environmentIdentity: 'declared-node-fixture',
    overallTimeoutMs,
    checks: checks ?? [
      {
        ...exitCheck('syntax'),
        command: {
          executable: process.execPath,
          arguments: ['--check', 'model.cjs'],
          timeoutMs: 5000,
        },
      },
      {
        id: 'unit',
        name: 'Existing unit tests',
        group: 'Correctness',
        required: true,
        dependsOn: ['syntax'],
        command: {
          executable: process.execPath,
          arguments: [
            '--test',
            '--test-reporter=junit',
            '--test-reporter-destination=tests.xml',
            'existing.test.cjs',
          ],
          timeoutMs: 5000,
        },
        report: { adapter: 'junit', adapterVersion: 1, path: 'tests.xml' },
        coverage: { minimumCases: 301, identityPolicy: 'stable-id' },
      },
      {
        id: 'benchmark',
        name: 'Existing benchmark',
        group: 'Measurements',
        required: false,
        dependsOn: ['unit'],
        command: {
          executable: process.execPath,
          arguments: ['benchmark.cjs'],
          timeoutMs: 5000,
        },
        report: {
          adapter: 'metrics-v1',
          adapterVersion: 1,
          path: 'metrics.json',
          cases: { adapter: 'cases-v1', adapterVersion: 1, path: 'cases.json' },
        },
        metrics: [
          {
            name: 'error',
            unit: 'n',
            direction: 'decrease',
            minimumImprovement: 0.1,
            maximumRegression: 0,
            minimumSamples: 301,
          },
        ],
      },
    ],
  });
  const plan = app.plans.draft(project.id, configuration);
  const request = { documentId: paper.id, planId: plan.id };
  const prepare = () => {
    app.plans.approve(plan.id, plan.fingerprint);
    return app.experiments.create(project.id, request);
  };
  const reopen = async () => {
    await app.close();
    app = createApp({
      logger: false,
      connectionSecret: secret,
      dispatcher: false,
      storage: { dataDirectory },
    });
    return app;
  };
  return {
    app,
    root,
    repository,
    dataDirectory,
    project,
    paper,
    plan,
    request,
    configuration,
    prepare,
    reopen,
  };
}
async function settle(app: ReturnType<typeof createApp>, id: string) {
  await vi.waitFor(
    () => expect(app.experiments.run(id).status).not.toBe('running'),
    { timeout: 10000, interval: 25 },
  );
  return runSchema.parse(app.experiments.run(id));
}
function ready(app: ReturnType<typeof createApp>, id: string) {
  const claim = app.experiments.claim(id, 'fixture-agent');
  return app.experiments.progress(
    id,
    claim.experiment.claimToken!,
    'Controlled candidate ready.',
    true,
  );
}
function attachAutomation(
  f: ReturnType<typeof fixture>,
  experimentId: string,
  maxRuns = 2,
) {
  const recommendation = f.app.discovery.storeRecommendation(f.project.id, {
    documentId: f.paper.id,
    title: 'Technique',
    summary: 'Fixture',
    applicability: 'Fixture project',
    prerequisites: [],
    uncertainty: 'Unmeasured',
    evaluationTargets: ['quality'],
    sources: [
      { documentId: f.paper.id, claim: 'improvement', evidence: 'fixture' },
    ],
    projectContextVersion: f.app.projects.get(f.project.id).currentContext
      .version,
  });
  const rule = {
    enabled: true,
    goals: ['quality'],
    categories: ['optimization'],
    planId: f.plan.id,
    maxExperiments: 1,
    maxRuns,
  };
  // Future activation storage fixture; public suite automation stays guarded.
  f.app.database.db
    .insert(automationRules)
    .values({
      projectId: f.project.id,
      payload: rule,
      approvedAt: new Date().toISOString(),
    })
    .run();
  f.app.database.db
    .insert(automationExperiments)
    .values({
      experimentId,
      projectId: f.project.id,
      recommendationId: recommendation.id,
      maxRuns,
    })
    .run();
  f.app.database.db
    .insert(appState)
    .values({
      key: `automation-reservation:${f.project.id}:${recommendation.id}`,
      value: JSON.stringify({ goal: 'quality', category: 'optimization' }),
      updatedAt: new Date(),
    })
    .run();
  return (changes: Partial<typeof rule>) =>
    f.app.database.db
      .update(automationRules)
      .set({ payload: { ...rule, ...changes } })
      .where(eq(automationRules.projectId, f.project.id))
      .run();
}

describe('suite experiment lifecycle', () => {
  it('requires exact approval, runs isolated baseline/candidate checks and persists automatic evidence', async () => {
    const f = fixture();
    expect(() => f.app.experiments.create(f.project.id, f.request)).toThrow(
      /Approve/,
    );
    const detail = f.prepare();
    expect(() =>
      f.app.experiments.startRun(detail.experiment.id, 'candidate'),
    ).toThrow(/ready/);
    const baseline = f.app.experiments.startRun(
      detail.experiment.id,
      'baseline',
    );
    expect(f.app.experiments.evidence.checks(baseline.id)).toHaveLength(3);
    expect(() =>
      f.app.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/already running/);
    const completed = await settle(f.app, baseline.id);
    expect(completed).toMatchObject({
      status: 'completed',
      result: { schemaVersion: 2, requiredValidation: 'passed' },
      suiteExecution: {
        datasetVerification: 'declared',
        environmentVerification: 'declared',
        authorization: { mode: 'manual', attemptNumber: 1, maxRuns: null },
        before: { status: 'observed' },
        after: { status: 'observed' },
      },
    });
    expect(completed.suiteExecution!.before.identity).toBe(
      completed.suiteExecution!.after!.identity,
    );
    expect(completed.suiteExecution!.before.lockfiles[0]!.path).toBe(
      'package-lock.json',
    );
    const records = f.app.experiments.evidence.checks(baseline.id);
    expect(records.map((check) => check.result.status)).toEqual([
      'passed',
      'passed',
      'passed',
    ]);
    expect(records[1]!.result.caseCount).toBe(301);
    expect(records[2]!.result.metrics[0]!.value).toBe(1);
    expect(
      records.every(
        (check) =>
          check.workspaceObservations?.before.status === 'observed' &&
          check.workspaceObservations.after?.status === 'observed',
      ),
    ).toBe(true);
    expect(
      f.app.experiments.evidence.cases(baseline.id, 'unit', { limit: 100 })
        .total,
    ).toBe(301);
    expect(
      f.app.experiments.artifact(baseline.id, 'unit--report.xml'),
    ).toContain('repository case');
    ready(f.app, detail.experiment.id);
    writeFileSync(
      join(detail.experiment.candidatePath, 'model.cjs'),
      'module.exports=value=>2*value;',
    );
    const candidate = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'candidate').id,
    );
    expect(candidate).toMatchObject({
      status: 'completed',
      suiteExecution: { authorization: { attemptNumber: 2 } },
    });
    expect(candidate.codeIdentity).not.toBe(completed.codeIdentity);
    expect(
      candidate.result?.schemaVersion === 2 &&
        candidate.result.checks[2]!.metrics[0]!.value,
    ).toBe(0);
    expect(readFileSync(join(f.repository, 'model.cjs'), 'utf8')).toContain(
      '99',
    );
    expect(() =>
      f.app.experiments.compare(
        detail.experiment.id,
        baseline.id,
        candidate.id,
      ),
    ).toThrow(/not available/);
    const reopened = await f.reopen();
    expect(reopened.experiments.run(candidate.id)).toEqual(candidate);
    expect(
      reopened.experiments.evidence.cases(baseline.id, 'unit', { limit: 100 })
        .total,
    ).toBe(301);
  }, 15000);
  it('keeps required test failures visible and skips their benchmark after implementation', async () => {
    const f = fixture(),
      detail = f.prepare();
    ready(f.app, detail.experiment.id);
    writeFileSync(
      join(detail.experiment.candidatePath, 'model.cjs'),
      'module.exports=value=>NaN;',
    );
    const run = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'candidate').id,
    );
    expect(run).toMatchObject({
      status: 'completed',
      result: { schemaVersion: 2, requiredValidation: 'failed' },
    });
    expect(
      run.result?.schemaVersion === 2 &&
        run.result.checks.map((check) => check.status),
    ).toEqual(['passed', 'failed', 'skipped']);
    expect(
      f.app.experiments.evidence.cases(run.id, 'unit', {
        limit: 100,
        status: 'failed',
      }).total,
    ).toBe(301);
    expect(
      existsSync(join(detail.experiment.candidatePath, 'metrics.json')),
    ).toBe(false);
  });
  it('charges each entire suite once, permits the last reserved attempt, and retains the original ceiling', async () => {
    const f = fixture(),
      detail = f.prepare(),
      changeRule = attachAutomation(f, detail.experiment.id);
    const baseline = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(baseline.suiteExecution!.authorization).toEqual({
      mode: 'automation',
      attemptNumber: 1,
      maxRuns: 2,
    });
    ready(f.app, detail.experiment.id);
    const candidate = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'candidate').id,
    );
    expect(candidate.status).toBe('completed');
    expect(candidate.suiteExecution!.authorization.attemptNumber).toBe(2);
    changeRule({ maxRuns: 10 });
    expect(() =>
      f.app.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/budget is exhausted/);
    expect(f.app.experiments.detail(detail.experiment.id).runs).toHaveLength(2);
  }, 15000);
  it('charges failed launches as full attempts and never retries checks automatically', async () => {
    const f = fixture([
      {
        ...exitCheck('missing'),
        command: {
          executable: 'paperloop-nonexistent-fixture-program',
          arguments: [],
          timeoutMs: 1000,
        },
      },
      exitCheck('later'),
    ]);
    const detail = f.prepare();
    attachAutomation(f, detail.experiment.id);
    const first = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(first.status).toBe('failed');
    expect(
      first.result?.schemaVersion === 2 && first.result.checks[1]!.status,
    ).toBe('skipped');
    expect(f.app.experiments.detail(detail.experiment.id).runs).toHaveLength(1);
    const second = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(second.id).not.toBe(first.id);
    expect(second.suiteExecution!.authorization.attemptNumber).toBe(2);
    expect(() =>
      f.app.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/budget/);
  });
  it('prevents rewriting the recorded before-observation while a check is active', async () => {
    const f = fixture([
        exitCheck(
          'slow',
          "require('fs').writeFileSync('ready.marker','ready');setInterval(()=>{},1000)",
        ),
      ]),
      detail = f.prepare();
    const run = f.app.experiments.startRun(detail.experiment.id, 'baseline');
    await vi.waitFor(() =>
      expect(
        existsSync(join(detail.experiment.baselinePath, 'ready.marker')),
      ).toBe(true),
    );
    const active = f.app.experiments.evidence.checks(run.id)[0]!;
    expect(() =>
      f.app.experiments.evidence.update({
        ...active,
        workspaceObservations: {
          before: {
            ...active.workspaceObservations!.before,
            identity: 'a'.repeat(64),
          },
          after: null,
        },
      }),
    ).toThrow(/cannot be replaced/);
    f.app.experiments.cancel(run.id);
    expect((await settle(f.app, run.id)).status).toBe('cancelled');
  });
  it('cancels an active suite when live automation authorization is revoked', async () => {
    const f = fixture([
      exitCheck(
        'slow',
        "require('fs').writeFileSync('ready.marker','ready');setInterval(()=>{},1000)",
      ),
      exitCheck('later', "require('fs').writeFileSync('never.marker','bad')"),
    ]);
    const detail = f.prepare(),
      changeRule = attachAutomation(f, detail.experiment.id);
    const started = f.app.experiments.startRun(
      detail.experiment.id,
      'baseline',
    );
    await vi.waitFor(() =>
      expect(
        existsSync(join(detail.experiment.baselinePath, 'ready.marker')),
      ).toBe(true),
    );
    changeRule({ enabled: false });
    const run = await settle(f.app, started.id);
    expect(run).toMatchObject({
      status: 'cancelled',
      result: {
        schemaVersion: 2,
        checks: [{ status: 'cancelled' }, { status: 'skipped' }],
      },
    });
    expect(
      existsSync(join(detail.experiment.baselinePath, 'never.marker')),
    ).toBe(false);
    expect(f.app.experiments.detail(detail.experiment.id).runs).toHaveLength(1);
  });
  it('honors a reduced live ceiling for an already reserved second attempt', async () => {
    const script =
      "const fs=require('fs');if(fs.existsSync('wait.flag')){fs.writeFileSync('ready.marker','ready');setInterval(()=>{},1000)}";
    const f = fixture([exitCheck('gate', script), exitCheck('later')]),
      detail = f.prepare(),
      changeRule = attachAutomation(f, detail.experiment.id);
    await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    ready(f.app, detail.experiment.id);
    writeFileSync(join(detail.experiment.candidatePath, 'wait.flag'), 'wait');
    const started = f.app.experiments.startRun(
      detail.experiment.id,
      'candidate',
    );
    await vi.waitFor(() =>
      expect(
        existsSync(join(detail.experiment.candidatePath, 'ready.marker')),
      ).toBe(true),
    );
    changeRule({ maxRuns: 1 });
    const run = await settle(f.app, started.id);
    expect(run.status).toBe('cancelled');
    expect(run.error).toMatch(/ceiling/);
    expect(run.suiteExecution!.authorization).toEqual({
      mode: 'automation',
      attemptNumber: 2,
      maxRuns: 2,
    });
    changeRule({ maxRuns: 10 });
    expect(() =>
      f.app.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/budget/);
  });
  it('interrupts and reconciles uncertain process termination without asserting final provenance', async () => {
    vi.spyOn(groups, 'confirmProcessGroupStopped').mockResolvedValue(false);
    const f = fixture([exitCheck('one'), exitCheck('later')]),
      detail = f.prepare();
    const run = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(run).toMatchObject({
      status: 'interrupted',
      suiteExecution: {
        before: { status: 'observed' },
        after: { status: 'unavailable', identity: null },
      },
    });
    expect(f.app.experiments.get(detail.experiment.id).status).toBe(
      'interrupted',
    );
    expect(() =>
      f.app.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/Reconcile/);
    vi.restoreAllMocks();
    f.app.experiments.reconcile(
      detail.experiment.id,
      'Fixture processes were inspected and stopped.',
    );
    const next = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(next.id).not.toBe(run.id);
    expect(next.suiteExecution!.authorization.attemptNumber).toBe(2);
  });
  it('preserves cases and interrupts the parent on a failed terminal evidence write', async () => {
    const f = fixture(),
      detail = f.prepare();
    const update = f.app.experiments.evidence.update.bind(
      f.app.experiments.evidence,
    );
    let failed = false;
    vi.spyOn(f.app.experiments.evidence, 'update').mockImplementation(
      (record) => {
        if (
          !failed &&
          record.result.checkId === 'unit' &&
          record.result.status === 'passed'
        ) {
          failed = true;
          throw new Error('Controlled evidence write failure');
        }
        return update(record);
      },
    );
    const run = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(run.status).toBe('interrupted');
    expect(run.error).toMatch(/persist/);
    expect(f.app.experiments.get(detail.experiment.id).status).toBe(
      'interrupted',
    );
    expect(
      f.app.experiments.evidence.cases(run.id, 'unit', { limit: 100 }).total,
    ).toBe(301);
    expect(
      run.result?.schemaVersion === 2 && run.result.checks[1],
    ).toMatchObject({
      status: 'interrupted',
      caseCount: 301,
      caseCoverage: 'partial',
    });
    expect(() =>
      f.app.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/Reconcile/);
    vi.restoreAllMocks();
    const reopened = await f.reopen();
    expect(
      reopened.experiments.evidence.cases(run.id, 'unit', { limit: 100 }).total,
    ).toBe(301);
  });
  it('stops on changed approval and preserves the original immutable check specifications', async () => {
    const f = fixture([
        exitCheck(
          'slow',
          "require('fs').writeFileSync('ready.marker','ready');setInterval(()=>{},1000)",
        ),
        exitCheck('later'),
      ]),
      detail = f.prepare();
    const started = f.app.experiments.startRun(
      detail.experiment.id,
      'baseline',
    );
    await vi.waitFor(() =>
      expect(
        existsSync(join(detail.experiment.baselinePath, 'ready.marker')),
      ).toBe(true),
    );
    f.app.database.db
      .update(evaluationPlans)
      .set({
        configuration: {
          ...f.configuration,
          name: 'Tampered without renewed approval',
        },
      })
      .where(eq(evaluationPlans.id, f.plan.id))
      .run();
    const run = await settle(f.app, started.id);
    expect(run.status).toBe('interrupted');
    expect(run.planFingerprint).toBe(f.plan.fingerprint);
    expect(f.app.experiments.evidence.checks(run.id)[1]!.startedAt).toBeNull();
  });
  it('persists cancellation through the existing authenticated HTTP route', async () => {
    const f = fixture([
        exitCheck('done'),
        exitCheck(
          'slow',
          "require('fs').writeFileSync('ready.marker','ready');setInterval(()=>{},1000)",
        ),
        exitCheck('later'),
      ]),
      detail = f.prepare();
    const run = f.app.experiments.startRun(detail.experiment.id, 'baseline');
    await vi.waitFor(() =>
      expect(
        existsSync(join(detail.experiment.baselinePath, 'ready.marker')),
      ).toBe(true),
    );
    const denied = await f.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.id}/cancel`,
      payload: {},
    });
    expect(denied.statusCode).toBe(401);
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.id}/cancel`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const cancelled = await settle(f.app, run.id);
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      result: {
        schemaVersion: 2,
        checks: [
          { status: 'passed' },
          { status: 'cancelled' },
          { status: 'skipped' },
        ],
      },
    });
  });
  it('counts observer work inside the overall execution deadline', async () => {
    const f = fixture(
      [exitCheck('slow', 'setInterval(()=>{},1000)'), exitCheck('later')],
      100,
    );
    const detail = f.prepare();
    const run = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(run.status).toBe('timed_out');
    expect(
      run.result?.schemaVersion === 2 && run.result.checks[1]!.status,
    ).toBe('skipped');
    expect(f.app.experiments.detail(detail.experiment.id).runs).toHaveLength(1);
  });
  it('records a restart as interrupted and never replays a reserved attempt', async () => {
    const f = fixture([exitCheck('one')]),
      detail = f.prepare();
    const completed = await settle(
      f.app,
      f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    // Controlled crash checkpoint: parent completion wasn't committed, checks were.
    const checkpoint = {
      ...completed,
      status: 'running' as const,
      result: null,
      finishedAt: null,
      suiteExecution: { ...completed.suiteExecution!, after: null },
    };
    f.app.database.db
      .update(evaluationRuns)
      .set({ status: 'running', payload: checkpoint })
      .where(eq(evaluationRuns.id, completed.id))
      .run();
    const reopened = await f.reopen();
    expect(reopened.experiments.run(completed.id)).toMatchObject({
      status: 'interrupted',
      result: { schemaVersion: 2, checks: [{ status: 'passed' }] },
      suiteExecution: { after: { status: 'unavailable', identity: null } },
    });
    expect(reopened.experiments.detail(detail.experiment.id).runs).toHaveLength(
      1,
    );
    expect(() =>
      reopened.experiments.startRun(detail.experiment.id, 'baseline'),
    ).toThrow(/Reconcile/);
  });
  it('exposes the same approved suite run and paged cases through HTTP and a real MCP client', async () => {
    const f = fixture();
    const denied = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.project.id}/experiments`,
      headers,
      payload: f.request,
    });
    expect(denied.statusCode).toBe(409);
    const forbidden = await f.app.inject({
      method: 'POST',
      url: `/api/v1/evaluations/${f.plan.id}/approve`,
      headers,
      payload: { fingerprint: f.plan.fingerprint },
    });
    expect(forbidden.statusCode).toBe(403);
    const session = await f.app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers,
    });
    const cookie = session.headers['set-cookie']!.toString().split(';')[0]!;
    const wrong = await f.app.inject({
      method: 'POST',
      url: `/api/v1/evaluations/${f.plan.id}/approve`,
      headers: { cookie },
      payload: { fingerprint: 'wrong-version' },
    });
    expect(wrong.statusCode).toBe(409);
    const approve = await f.app.inject({
      method: 'POST',
      url: `/api/v1/evaluations/${f.plan.id}/approve`,
      headers: { cookie },
      payload: { fingerprint: f.plan.fingerprint },
    });
    expect(approve.statusCode).toBe(200);
    await f.app.listen({ host: '127.0.0.1', port: 0 });
    const address = f.app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected fixture port');
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers } },
    );
    const client = new Client({
      name: 'suite-experiment-test',
      version: '1.0.0',
    });
    await client.connect(transport as unknown as Transport);
    cleanups.push(() => client.close());
    expect(
      (await client.listTools()).tools.some((tool) =>
        /approve/.test(tool.name),
      ),
    ).toBe(false);
    const created = await client.callTool({
      name: 'implement_paper',
      arguments: { projectId: f.project.id, request: f.request },
    });
    expect(created.isError).not.toBe(true);
    const id = (created.structuredContent as { experiment: { id: string } })
      .experiment.id;
    const started = await client.callTool({
      name: 'evaluations_run',
      arguments: { experimentId: id, role: 'baseline' },
    });
    expect(started.isError).not.toBe(true);
    const run = runSchema.parse(started.structuredContent);
    await settle(f.app, run.id);
    const result = await client.callTool({
      name: 'evaluations_run_get',
      arguments: { runId: run.id },
    });
    expect(
      runSchema.parse(result.structuredContent).suiteExecution!.before.status,
    ).toBe('observed');
    const checks = await client.callTool({
      name: 'evaluations_run_checks',
      arguments: { runId: run.id },
    });
    expect(
      suiteCheckListSchema.parse(checks.structuredContent).checks,
    ).toHaveLength(3);
    const cases = await client.callTool({
      name: 'evaluations_run_cases',
      arguments: { runId: run.id, checkId: 'unit', limit: 100 },
    });
    expect(cases.structuredContent).toMatchObject({
      total: 301,
      cases: expect.any(Array),
      nextCursor: expect.any(String),
    });
    const response = await f.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.id}/checks`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(
      suiteCheckListSchema.parse(response.json()).checks[1]!
        .workspaceObservations!.after!.status,
    ).toBe('observed');
    const imports = await f.app.inject({
      method: 'POST',
      url: `/api/v1/experiments/${id}/external-results`,
      headers,
      payload: {
        role: 'candidate',
        producerIdentity: 'fixture',
        codeIdentity: 'declared',
        result: {
          schemaVersion: 1,
          metrics: [{ name: 'error', unit: 'n', value: 0 }],
          artifacts: [],
        },
      },
    });
    expect(imports.statusCode).toBe(409);
    expect(f.app.experiments.detail(id).runs).toHaveLength(1);
  }, 15000);
});

describe('bounded workspace observations', () => {
  it('observes code and lock changes while excluding only approved report paths', () => {
    const f = fixture(),
      scope = observationScope(f.repository, f.configuration);
    const before = workspaceObservationSchema.parse(
      observeWorkspace(f.repository, scope),
    );
    expect(before.status).toBe('observed');
    writeFileSync(join(f.repository, 'tests.xml'), '<testsuite/>');
    expect(observeWorkspace(f.repository, scope).identity).toBe(
      before.identity,
    );
    writeFileSync(
      join(f.repository, 'model.cjs'),
      'module.exports=value=>2*value;',
    );
    expect(observeWorkspace(f.repository, scope).identity).not.toBe(
      before.identity,
    );
    writeFileSync(
      join(f.repository, 'package-lock.json'),
      '{"lockfileVersion":3,"changed":true}',
    );
    expect(observeWorkspace(f.repository, scope).lockfiles[0]!.sha256).not.toBe(
      before.lockfiles[0]!.sha256,
    );
  });
  it.each(['symlink', 'oversized'])(
    'reports unavailable provenance for a %s without following or fully reading it',
    async (kind) => {
      const f = fixture([exitCheck('one')]),
        detail = f.prepare();
      if (kind === 'symlink')
        symlinkSync(
          '/etc/passwd',
          join(detail.experiment.baselinePath, 'unsafe'),
        );
      else {
        writeFileSync(join(detail.experiment.baselinePath, 'large'), '');
        truncateSync(join(detail.experiment.baselinePath, 'large'), 10000001);
      }
      const run = await settle(
        f.app,
        f.app.experiments.startRun(detail.experiment.id, 'baseline').id,
      );
      expect(run.status).toBe('completed');
      expect(run.codeIdentity).toBe('unobserved');
      expect(run.suiteExecution!.before).toMatchObject({
        status: 'unavailable',
        identity: null,
        reason: expect.any(String),
      });
      expect(run.suiteExecution!.environmentVerification).toBe('declared');
    },
  );
});
