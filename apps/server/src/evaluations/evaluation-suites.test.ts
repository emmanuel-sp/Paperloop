import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluationSuiteDraftSchema,
  legacyEvaluationPlanDraftSchema,
  experimentSchema,
  runSchema,
  suiteCaseSchema,
  type SuiteCheckRecord,
} from '@paperloop/contracts';
import { createApp } from '../app.js';
import { fingerprint } from './plan-service.js';
import { executePlan } from './runner.js';
import {
  evaluationPlans,
  evaluationRuns,
  experiments,
} from '../storage/schema.js';
const headers = { authorization: 'Bearer suite-test' };
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const example = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../docs/evaluation-design/examples/ml.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'paperloop-suite-'));
  const dataDirectory = join(root, 'data');
  const app = createApp({
    logger: false,
    connectionSecret: 'suite-test',
    storage: { dataDirectory },
  });
  cleanup.push(() => app.close());
  const project = app.projects.create({
    name: 'Suite project',
    description: 'Verify the model',
    objectives: [],
    constraints: [],
    repository: { kind: 'local', path: root },
  });
  const paper = app.research.ingest(project.id, {
    title: 'Technique',
    sourceKind: 'reference',
    sourceReference: 'fixture',
    extractionStatus: 'unavailable',
    authors: [],
    submittedBy: 'user',
  });
  const plan = app.plans.draft(
    project.id,
    evaluationSuiteDraftSchema.parse(example()),
  );
  app.plans.approve(plan.id, plan.fingerprint);
  // Future harness storage fixture; no command or repository checkout runs here.
  const experiment = experimentSchema.parse({
    id: randomUUID(),
    projectId: project.id,
    documentId: paper.id,
    planId: plan.id,
    contextId: project.currentContext.id,
    briefId: null,
    status: 'ready',
    baselinePath: root,
    candidatePath: root,
    baselineRevision: 'fixture',
    claimToken: null,
    claimOwner: null,
    claimExpiresAt: null,
    progress: 'fixture',
    reconciliation: null,
    createdAt: new Date().toISOString(),
  });
  app.database.db
    .insert(experiments)
    .values({
      id: experiment.id,
      projectId: project.id,
      documentId: paper.id,
      planId: plan.id,
      status: experiment.status,
      payload: experiment,
    })
    .run();
  const run = runSchema.parse({
    id: randomUUID(),
    experimentId: experiment.id,
    planId: plan.id,
    role: 'baseline',
    status: 'running',
    producer: 'harness',
    producerIdentity: 'storage-fixture',
    codeIdentity: 'fixture-only',
    planFingerprint: plan.fingerprint,
    datasetIdentity: plan.configuration.datasetIdentity,
    environmentIdentity: plan.configuration.environmentIdentity,
    result: null,
    error: null,
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    artifactReferences: [],
  });
  app.database.db
    .insert(evaluationRuns)
    .values({
      id: run.id,
      experimentId: experiment.id,
      status: run.status,
      payload: run,
    })
    .run();
  return { app, root, dataDirectory, project, paper, plan, experiment, run };
}
function running(record: SuiteCheckRecord): SuiteCheckRecord {
  return {
    ...record,
    startedAt: new Date().toISOString(),
    result: { ...record.result, status: 'running' },
  };
}
function cases(amount: number, offset = 0) {
  return Array.from({ length: amount }, (_, i) =>
    suiteCaseSchema.parse({
      id: `case-${i + offset}`,
      label: `Measured case ${i + offset}`,
      status: (i + offset) % 3 === 0 ? 'failed' : 'passed',
    }),
  );
}

describe('suite storage and compatibility boundaries', () => {
  it('preserves historical fingerprint bytes and exact approvals while canonicalizing only v2', () => {
    const { app, project, plan } = fixture();
    const input = legacyEvaluationPlanDraftSchema.parse({
      name: 'Legacy',
      datasetIdentity: 'data',
      environmentIdentity: 'env',
      cases: ['label'],
      metrics: [
        {
          name: 'score',
          unit: 'n',
          direction: 'increase',
          minimumImprovement: 1,
          maximumRegression: 0,
        },
      ],
      command: {
        executable: 'node',
        arguments: [],
        resultPath: 'result.json',
        timeoutMs: 1000,
      },
    });
    const legacy = app.plans.draft(project.id, input);
    expect(legacy.fingerprint).toBe(
      createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    );
    app.plans.approve(legacy.id, legacy.fingerprint);
    expect(Object.isFrozen(plan.configuration)).toBe(true);
    const reorderedInput = example();
    reorderedInput.checks[0].command = Object.fromEntries(
      Object.entries(reorderedInput.checks[0].command).reverse(),
    );
    const reordered = Object.fromEntries(
      Object.entries(reorderedInput).reverse(),
    );
    expect(fingerprint(reordered)).toBe(fingerprint(example()));
    const changed = example();
    changed.checks[0].command.arguments.push('extra');
    const revision = app.plans.draft(
      project.id,
      evaluationSuiteDraftSchema.parse(changed),
    );
    expect(revision.approvedAt).toBeNull();
    expect(revision.fingerprint).not.toBe(plan.fingerprint);
    expect(() => app.plans.approve(revision.id, plan.fingerprint)).toThrow(
      /exact plan/,
    );
    expect(app.plans.requireApproved(legacy.id).fingerprint).toBe(
      legacy.fingerprint,
    );
    app.database.db
      .update(evaluationPlans)
      .set({ configuration: revision.configuration })
      .where(eq(evaluationPlans.id, plan.id))
      .run();
    expect(() => app.plans.approve(plan.id, plan.fingerprint)).toThrow(
      /exact plan/,
    );
    expect(() => app.plans.requireApproved(plan.id)).toThrow(/Approve/);
  });
  it('blocks suite preparation, running, imports, comparison, and automation before side effects', () => {
    const { app, project, paper, plan, experiment, run, root } = fixture();
    expect(() =>
      app.experiments.create(project.id, {
        documentId: paper.id,
        planId: plan.id,
      }),
    ).toThrow(/not available/);
    expect(() => app.experiments.startRun(experiment.id, 'baseline')).toThrow(
      /not available/,
    );
    expect(() =>
      app.experiments.importResult(
        experiment.id,
        'candidate',
        'agent',
        'code',
        {
          schemaVersion: 1,
          metrics: [{ name: 'score', unit: 'n', value: 1 }],
          artifacts: [],
        },
      ),
    ).toThrow(/not available/);
    expect(() =>
      app.experiments.compare(experiment.id, run.id, run.id),
    ).toThrow(/not available/);
    expect(() =>
      app.schedules.approveRule(project.id, {
        planId: plan.id,
        enabled: true,
        goals: ['quality'],
        categories: ['optimization'],
        maxExperiments: 1,
        maxRuns: 2,
      }),
    ).toThrow(/not available/);
    expect(() => executePlan(plan, root, join(root, 'artifacts'))).toThrow(
      /not available/,
    );
    expect(app.experiments.detail(experiment.id).runs).toHaveLength(1);
  });
  it('backs up v6 data without changing historical approvals, run payloads, or comparison evidence', async () => {
    const { app, project, experiment, run, dataDirectory } = fixture();
    const configuration = legacyEvaluationPlanDraftSchema.parse({
      name: 'Legacy',
      datasetIdentity: 'data',
      environmentIdentity: 'env',
      cases: ['label'],
      metrics: [
        {
          name: 'score',
          unit: 'n',
          direction: 'increase',
          minimumImprovement: 1,
          maximumRegression: 0,
        },
      ],
      command: {
        executable: 'node',
        arguments: [],
        resultPath: 'result.json',
        timeoutMs: 1000,
      },
    });
    const legacy = app.plans.draft(project.id, configuration);
    app.plans.approve(legacy.id, legacy.fingerprint);
    const oldRun = {
      ...run,
      planId: legacy.id,
      planFingerprint: legacy.fingerprint,
      status: 'completed' as const,
      datasetIdentity: 'data',
      environmentIdentity: 'env',
      result: {
        schemaVersion: 1 as const,
        metrics: [{ name: 'score', unit: 'n', value: 7 }],
        artifacts: [],
      },
      finishedAt: new Date().toISOString(),
    };
    app.database.db
      .update(evaluationRuns)
      .set({ status: oldRun.status, payload: oldRun })
      .where(eq(evaluationRuns.id, run.id))
      .run();
    const before = app.database.sqlite
      .prepare(
        'SELECT configuration, fingerprint, approved_at FROM evaluation_plans WHERE id = ?',
      )
      .get(legacy.id);
    const runBefore = app.database.sqlite
      .prepare('SELECT payload FROM evaluation_runs WHERE id = ?')
      .get(run.id);
    const comparison = JSON.stringify({
      id: randomUUID(),
      experimentId: experiment.id,
      baselineRunId: run.id,
      candidateRunId: run.id,
      outcome: 'inconclusive',
      reasons: ['historical'],
      metrics: [],
      createdAt: new Date().toISOString(),
    });
    app.database.sqlite
      .prepare(
        'INSERT INTO experiment_comparisons (id, experiment_id, payload) VALUES (?, ?, ?)',
      )
      .run(randomUUID(), experiment.id, comparison);
    app.database.sqlite.exec(
      'DROP TABLE evaluation_run_cases; DROP TABLE evaluation_run_checks; DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations); PRAGMA user_version = 6;',
    );
    await app.close();
    cleanup.pop();
    const reopened = createApp({
      logger: false,
      connectionSecret: 'suite-test',
      storage: { dataDirectory },
    });
    cleanup.push(() => reopened.close());
    expect(reopened.database.backupPath).toBeTruthy();
    expect(
      reopened.database.sqlite.pragma('user_version', { simple: true }),
    ).toBe(7);
    expect(
      reopened.database.sqlite
        .prepare(
          'SELECT configuration, fingerprint, approved_at FROM evaluation_plans WHERE id = ?',
        )
        .get(legacy.id),
    ).toEqual(before);
    expect(
      reopened.database.sqlite
        .prepare('SELECT payload FROM evaluation_runs WHERE id = ?')
        .get(run.id),
    ).toEqual(runBefore);
    expect(
      reopened.database.sqlite
        .prepare('SELECT payload FROM experiment_comparisons')
        .pluck()
        .get(),
    ).toBe(comparison);
    expect(reopened.plans.requireApproved(legacy.id).fingerprint).toBe(
      legacy.fingerprint,
    );
    expect(reopened.experiments.evidence.checks(run.id)).toEqual([]);
    expect(reopened.experiments.run(run.id).result?.schemaVersion).toBe(1);
  });
  it('atomically appends hundreds of cases, pages without duplication, and rejects cursor/filter drift', async () => {
    const { app, run } = fixture();
    const records = app.experiments.evidence.initialize(run.id);
    expect(app.experiments.evidence.initialize(run.id)).toEqual(records);
    const check = app.experiments.evidence.update(running(records[1]!));
    app.experiments.evidence.appendCases(
      run.id,
      check.specification.id,
      cases(301),
    );
    expect(() =>
      app.experiments.evidence.appendCases(run.id, check.specification.id, [
        cases(1, 500)[0]!,
        cases(1)[0]!,
      ]),
    ).toThrow(/unique/);
    const all = [];
    let cursor: string | undefined;
    do {
      const page = app.experiments.evidence.cases(
        run.id,
        check.specification.id,
        { limit: 100, cursor },
      );
      all.push(...page.cases);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(all).toHaveLength(301);
    expect(new Set(all.map((item) => item.id)).size).toBe(301);
    const first = app.experiments.evidence.cases(
      run.id,
      check.specification.id,
      { limit: 100, status: 'failed' },
    );
    expect(first.total).toBe(101);
    expect(() =>
      app.experiments.evidence.cases(run.id, check.specification.id, {
        limit: 100,
        cursor: first.nextCursor!,
      }),
    ).toThrow(/same run/);
    expect(() =>
      app.experiments.evidence.cases(run.id, records[0]!.specification.id, {
        limit: 100,
        status: 'failed',
        cursor: first.nextCursor!,
      }),
    ).toThrow(/same run/);
    expect(() =>
      app.experiments.evidence.cases(run.id, check.specification.id, {
        limit: 101,
      }),
    ).toThrow();
    const url = `/api/v1/runs/${run.id}/checks/${check.specification.id}/cases`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: `${url}?limit=101`, headers })).statusCode,
    ).toBe(400);
    const response = await app.inject({ url: `${url}?limit=100`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().cases).toHaveLength(100);
    expect(response.json().total).toBe(301);
    expect(
      (
        await app.inject({ url: `/api/v1/runs/${run.id}/checks`, headers })
      ).json().checks,
    ).toHaveLength(3);
    const finished: SuiteCheckRecord = {
      ...check,
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      result: {
        ...check.result,
        status: 'failed',
        evidenceStatus: 'valid',
        caseCoverage: 'complete',
        caseCount: 300,
        exitCode: 1,
      },
    };
    expect(() => app.experiments.evidence.update(finished)).toThrow(
      /match stored/,
    );
    app.experiments.evidence.update({
      ...finished,
      result: { ...finished.result, caseCount: 301 },
    });
    expect(() =>
      app.experiments.evidence.appendCases(
        run.id,
        check.specification.id,
        cases(1, 500),
      ),
    ).toThrow(/running check/);
    expect(() => app.experiments.evidence.update(finished)).toThrow(
      /immutable/,
    );
  });
  it('preserves completed checks and partial cases on restart; interrupts active and unstarted checks', async () => {
    const { app, run, dataDirectory } = fixture();
    const [first, second] = app.experiments.evidence.initialize(run.id);
    const active = app.experiments.evidence.update(running(first!));
    app.experiments.evidence.update({
      ...active,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      result: {
        ...active.result,
        status: 'passed',
        evidenceStatus: 'valid',
        exitCode: 0,
      },
    });
    app.experiments.evidence.update(running(second!));
    app.experiments.evidence.appendCases(
      run.id,
      second!.specification.id,
      cases(20),
    );
    await app.close();
    cleanup.pop();
    const reopened = createApp({
      logger: false,
      connectionSecret: 'suite-test',
      storage: { dataDirectory },
    });
    cleanup.push(() => reopened.close());
    expect(reopened.experiments.run(run.id)).toMatchObject({
      status: 'interrupted',
      result: {
        schemaVersion: 2,
        requiredValidation: 'unknown',
        checks: [
          { status: 'passed' },
          { status: 'interrupted', caseCount: 20, caseCoverage: 'partial' },
          { status: 'interrupted' },
        ],
      },
    });
    expect(
      reopened.experiments.evidence
        .checks(run.id)
        .map((check) => check.result.status),
    ).toEqual(['passed', 'interrupted', 'interrupted']);
    expect(
      reopened.experiments.evidence.cases(run.id, second!.specification.id, {
        limit: 100,
      }).total,
    ).toBe(20);
    expect(() => reopened.experiments.evidence.initialize(run.id)).toThrow(
      /active parent/,
    );
  });
  it('enforces approved specifications, case identity, and the 10,000/check and 50,000/run ceilings', () => {
    const { app, run, plan } = fixture();
    const expanded = example();
    expanded.checks = Array.from({ length: 6 }, (_, i) => ({
      ...expanded.checks[0],
      id: `c${i}`,
    }));
    const configuration = evaluationSuiteDraftSchema.parse(expanded);
    const hash = fingerprint(configuration);
    app.database.db
      .update(evaluationPlans)
      .set({ configuration, fingerprint: hash })
      .where(eq(evaluationPlans.id, plan.id))
      .run();
    app.database.db
      .update(evaluationRuns)
      .set({ payload: { ...run, planFingerprint: hash } })
      .where(eq(evaluationRuns.id, run.id))
      .run();
    const checks = app.experiments.evidence.initialize(run.id);
    const first = running(checks[0]!);
    expect(() =>
      app.experiments.evidence.update({
        ...first,
        specification: { ...first.specification, required: false },
      }),
    ).toThrow(/approved specification/);
    for (let i = 0; i < 5; i++) {
      app.experiments.evidence.update(running(checks[i]!));
      // Keep each append below the report-byte limit, using stable case ordinals.
      for (let offset = 0; offset < 10000; offset += 1000)
        app.experiments.evidence.appendCases(
          run.id,
          checks[i]!.specification.id,
          cases(1000, offset),
        );
    }
    expect(() =>
      app.experiments.evidence.appendCases(
        run.id,
        checks[0]!.specification.id,
        cases(1, 20000),
      ),
    ).toThrow(/bound/);
    app.experiments.evidence.update(running(checks[5]!));
    expect(() =>
      app.experiments.evidence.appendCases(
        run.id,
        checks[5]!.specification.id,
        cases(1),
      ),
    ).toThrow(/bound/);
  }, 30000);
  it('round-trips v2 drafts through HTTP and MCP, exposing read-only paged evidence tools without approval tooling', async () => {
    const { app, project, root, run } = fixture();
    writeFileSync(
      join(root, 'paperloop.evaluation.json'),
      JSON.stringify(example()),
    );
    const suggestion = (
      await app.inject({
        url: `/api/v1/projects/${project.id}/evaluation-suggestion`,
        headers,
      })
    ).json();
    expect(suggestion.plan.configuration.formatVersion).toBe(2);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/evaluations`,
      headers,
      payload: example(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().approvedAt).toBeNull();
    const [first] = app.experiments.evidence.initialize(run.id);
    app.experiments.evidence.update(running(first!));
    app.experiments.evidence.appendCases(
      run.id,
      first!.specification.id,
      cases(101),
    );
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const client = new Client({ name: 'suite-test', version: '1' });
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
        requestInit: { headers },
      }) as unknown as Transport,
    );
    const listed = await client.listTools();
    expect(listed.tools.some((tool) => /approve/.test(tool.name))).toBe(false);
    expect(
      listed.tools.find((tool) => tool.name === 'evaluations_run_cases')
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    const draft = await client.callTool({
      name: 'evaluations_draft',
      arguments: { projectId: project.id, plan: example() },
    });
    expect(draft.isError).not.toBe(true);
    expect(draft.structuredContent).toMatchObject({
      approvedAt: null,
      configuration: { formatVersion: 2 },
    });
    const page = await client.callTool({
      name: 'evaluations_run_cases',
      arguments: {
        runId: run.id,
        checkId: first!.specification.id,
        limit: 100,
      },
    });
    expect(page.isError).not.toBe(true);
    expect(page.structuredContent).toMatchObject({
      total: 101,
      nextCursor: expect.any(String),
    });
    const invalid = await client.callTool({
      name: 'evaluations_run_cases',
      arguments: {
        runId: run.id,
        checkId: first!.specification.id,
        limit: 101,
      },
    });
    expect(invalid.isError).toBe(true);
    expect(
      app.database.db
        .select()
        .from(evaluationRuns)
        .where(
          and(
            eq(evaluationRuns.id, run.id),
            eq(evaluationRuns.status, 'running'),
          ),
        )
        .all(),
    ).toHaveLength(1);
  });
});
