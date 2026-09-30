import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  evaluationPlanDraftSchema,
  ingestResearchDocumentRequestSchema,
  type EvaluationRun,
} from '@paperloop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { executePlan } from '../evaluations/runner.js';
import * as processGroup from '../evaluations/process-group.js';
import { evaluationRuns, experiments } from '../storage/schema.js';
import { eq } from 'drizzle-orm';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.allSettled(
    cleanup
      .splice(0)
      .reverse()
      .map((close) => close()),
  );
});
const secret = 'workflow-test-connection';
const evaluator = `import json, pathlib
value = float(pathlib.Path('score.txt').read_text())
pathlib.Path('evidence.txt').write_text('measured sample')
pathlib.Path('result.json').write_text(json.dumps({'schemaVersion':1,'metrics':[{'name':'score','value':value,'unit':'points','samples':[value]}],'artifacts':['evidence.txt']}))
print('evaluation complete')
`;
const draft = (script = 'evaluate.py', timeoutMs = 2000) =>
  evaluationPlanDraftSchema.parse({
    name: 'Quality plan',
    datasetIdentity: 'fixture-v1',
    cases: ['sample-1'],
    metrics: [
      {
        name: 'score',
        unit: 'points',
        direction: 'increase',
        minimumImprovement: 1,
        maximumRegression: 0,
      },
    ],
    command: {
      executable: '/usr/bin/python3',
      arguments: [script],
      resultPath: 'result.json',
      timeoutMs,
    },
    environmentIdentity: 'python3-local-fixture',
  });
async function fixture(gitRepository = true) {
  const repository = mkdtempSync(
    join(tmpdir(), 'paperloop-workflow-repository-'),
  );
  writeFileSync(join(repository, 'evaluate.py'), evaluator);
  writeFileSync(join(repository, 'score.txt'), '10');
  if (gitRepository) {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe' });
    git('init');
    git('add', '.');
    git(
      '-c',
      'user.name=Workflow Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-m',
      'fixture',
    );
    // A dirty original must remain untouched by every experiment operation.
    writeFileSync(join(repository, 'score.txt'), '99');
  }
  const dataDirectory = mkdtempSync(join(tmpdir(), 'paperloop-workflow-data-'));
  const app = createApp({
    connectionSecret: secret,
    logger: false,
    storage: { dataDirectory },
  });
  cleanup.push(() => app.close());
  const project = app.projects.create({
    name: 'Experiment fixture',
    description: '',
    objectives: [],
    constraints: [],
    repository: { kind: 'local', path: repository },
  });
  const paper = app.research.ingest(
    project.id,
    ingestResearchDocumentRequestSchema.parse({
      title: 'Quality technique',
      sourceKind: 'reference',
      sourceReference: 'Fixture paper',
      extractionStatus: 'complete',
      extractedContent: 'Increase the score.',
      submittedBy: 'user',
    }),
  );
  const plan = app.plans.draft(project.id, draft());
  return { app, repository, dataDirectory, project, paper, plan };
}
async function settle(
  app: ReturnType<typeof createApp>,
  id: string,
): Promise<EvaluationRun> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = app.experiments.run(id);
    if (run.status !== 'running') return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Evaluation did not settle.');
}

describe('milestone 2 experiment loop', () => {
  it('persists uncertain process cleanup as interrupted and blocks retries until reconciliation', async () => {
    const { app, project, paper, plan } = await fixture();
    app.plans.approve(plan.id, plan.fingerprint);
    const id = app.experiments.create(project.id, {
      documentId: paper.id,
      planId: plan.id,
    }).experiment.id;
    const inspection = vi
      .spyOn(processGroup, 'confirmProcessGroupStopped')
      .mockResolvedValue(false);
    try {
      const run = await settle(
        app,
        app.experiments.startRun(id, 'baseline').id,
      );
      expect(run).toMatchObject({
        status: 'interrupted',
        result: null,
        error: expect.stringContaining('Could not confirm'),
      });
      expect(app.experiments.get(id).status).toBe('interrupted');
      expect(() => app.experiments.startRun(id, 'baseline')).toThrow(
        /Reconcile/,
      );
      expect(() => app.experiments.claim(id, 'retry')).toThrow(
        /reconciliation/,
      );
    } finally {
      inspection.mockRestore();
    }
    app.experiments.reconcile(
      id,
      'Inspected the isolated workspaces and confirmed no surviving evaluator processes.',
    );
    expect(
      (await settle(app, app.experiments.startRun(id, 'baseline').id)).status,
    ).toBe('completed');
  });
  it('connects UI-only approval, real MCP implementation, Python runs, comparison, and durable evidence', async () => {
    const { app, repository, dataDirectory, project, paper, plan } =
      await fixture();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const client = new Client({ name: 'implementation-agent', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${secret}` } },
      }) as unknown as Transport,
    );
    cleanup.push(() => client.close());
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => /approve/.test(tool.name))).toBe(false);
    const request = { documentId: paper.id, planId: plan.id };
    expect(
      (
        await client.callTool({
          name: 'implement_paper',
          arguments: { projectId: project.id, request },
        })
      ).isError,
    ).toBe(true);
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/evaluations/${plan.id}/approve`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { fingerprint: plan.fingerprint },
    });
    expect(forbidden.statusCode).toBe(403);
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers: { authorization: `Bearer ${secret}` },
    });
    const cookie = session.headers['set-cookie']!.toString().split(';')[0]!;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/evaluations/${plan.id}/approve`,
          headers: { cookie },
          payload: { fingerprint: 'different-version' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/evaluations/${plan.id}/approve`,
          headers: { cookie },
          payload: { fingerprint: plan.fingerprint },
        })
      ).statusCode,
    ).toBe(200);
    const prepared = await client.callTool({
      name: 'implement_paper',
      arguments: { projectId: project.id, request },
    });
    expect(prepared.isError).not.toBe(true);
    const detail = prepared.structuredContent as unknown as ReturnType<
      typeof app.experiments.detail
    >;
    const id = detail.experiment.id;
    expect(app.experiments.create(project.id, request).experiment.id).toBe(id);
    expect(() => app.experiments.startRun(id, 'candidate')).toThrow(/ready/);
    const baseline = await settle(
      app,
      app.experiments.startRun(id, 'baseline').id,
    );
    expect(baseline.status).toBe('completed');
    expect(baseline.result?.metrics[0]?.value).toBe(10);
    const claimed = await client.callTool({
      name: 'experiments_claim',
      arguments: { experimentId: id, owner: 'test-agent' },
    });
    const token = (claimed.structuredContent as unknown as typeof detail)
      .experiment.claimToken!;
    expect(() => app.experiments.claim(id, 'other-agent')).toThrow(/owned/);
    expect(() =>
      app.experiments.progress(id, 'wrong-token', 'Working', true),
    ).toThrow(/token/);
    writeFileSync(join(detail.experiment.candidatePath, 'score.txt'), '12');
    expect(
      (
        await client.callTool({
          name: 'experiments_progress',
          arguments: {
            experimentId: id,
            token,
            message: 'Applied the paper technique in the isolated candidate.',
            ready: true,
          },
        })
      ).isError,
    ).not.toBe(true);
    const started = await client.callTool({
      name: 'evaluations_run',
      arguments: { experimentId: id, role: 'candidate' },
    });
    const candidate = await settle(
      app,
      (started.structuredContent as unknown as EvaluationRun).id,
    );
    expect(candidate.status).toBe('completed');
    expect(candidate.codeIdentity).not.toBe(baseline.codeIdentity);
    const compared = await client.callTool({
      name: 'experiments_compare',
      arguments: {
        experimentId: id,
        baselineRunId: baseline.id,
        candidateRunId: candidate.id,
      },
    });
    expect(compared.structuredContent).toMatchObject({
      outcome: 'improvement',
      metrics: [{ delta: 2, percentChange: 20, passed: true }],
    });
    const recommendation = app.discovery.storeRecommendation(project.id, {
      documentId: paper.id,
      title: 'Evaluate the supplied technique',
      summary: 'Compare one isolated change.',
      applicability: 'Matches this project objective.',
      prerequisites: [],
      uncertainty: 'Source results may not transfer.',
      evaluationTargets: ['Compare score under the approved harness'],
      sources: [
        {
          documentId: paper.id,
          claim: 'A useful technique.',
          evidence: 'The supplied research.',
        },
      ],
      projectContextVersion: project.currentContext.version,
    });
    const tested = await client.callTool({
      name: 'research_triage',
      arguments: {
        projectId: project.id,
        recommendationId: recommendation.id,
        triage: {
          state: 'tested',
          reason: 'Completed the approved comparison.',
          experimentId: id,
        },
      },
    });
    expect(tested.isError).not.toBe(true);
    expect(tested.structuredContent).toMatchObject({
      state: 'tested',
      experimentId: id,
    });
    expect(app.experiments.artifact(candidate.id, 'stdout.log')).toContain(
      'evaluation complete',
    );
    expect(app.experiments.artifact(candidate.id, 'artifact-0')).toBe(
      'measured sample',
    );
    expect(() =>
      app.experiments.artifact(candidate.id, '../../score.txt'),
    ).toThrow(/registered/);
    expect(readFileSync(join(repository, 'score.txt'), 'utf8')).toBe('99');
    const changed = app.plans.draft(project.id, {
      ...draft(),
      datasetIdentity: 'fixture-v2',
    });
    expect(changed.version).toBe(2);
    expect(() => app.plans.requireApproved(changed.id)).toThrow(/Approve/);
    await client.close();
    await app.close();
    const restarted = createApp({
      connectionSecret: secret,
      logger: false,
      storage: { dataDirectory },
    });
    cleanup.push(() => restarted.close());
    expect(restarted.discovery.recommendations(project.id)).toMatchObject([
      { state: 'tested', experimentId: id },
    ]);
    expect(restarted.experiments.detail(id)).toMatchObject({
      experiment: { status: 'completed' },
      comparisons: [{ outcome: 'improvement' }],
      runs: [{ status: 'completed' }, { status: 'completed' }],
    });
  });

  it('reconciles expired ownership and persisted in-flight execution before retry', async () => {
    const { app, dataDirectory, project, paper, plan } = await fixture();
    app.plans.approve(plan.id, plan.fingerprint);
    const detail = app.experiments.create(project.id, {
      documentId: paper.id,
      planId: plan.id,
    });
    const id = detail.experiment.id;
    const owned = app.experiments.claim(id, 'agent').experiment;
    app.database.db
      .update(experiments)
      .set({ payload: { ...owned, claimExpiresAt: new Date(0).toISOString() } })
      .where(eq(experiments.id, id))
      .run();
    expect(() =>
      app.experiments.progress(id, owned.claimToken!, 'Late heartbeat', true),
    ).toThrow(/expired/);
    expect(() => app.experiments.startRun(id, 'baseline')).toThrow(/Reconcile/);
    app.experiments.reconcile(
      id,
      'Inspected both workspaces and confirmed no live processes.',
    );
    const newClaim = app.experiments.claim(id, 'new-agent').experiment;
    expect(newClaim.claimToken).not.toBe(owned.claimToken);
    app.experiments.progress(id, newClaim.claimToken!, 'Ready', true);
    const run = await settle(app, app.experiments.startRun(id, 'baseline').id);
    app.database.db
      .update(evaluationRuns)
      .set({
        status: 'running',
        payload: { ...run, status: 'running', finishedAt: null },
      })
      .where(eq(evaluationRuns.id, run.id))
      .run();
    await app.close();
    const restarted = createApp({
      connectionSecret: secret,
      logger: false,
      storage: { dataDirectory },
    });
    cleanup.push(() => restarted.close());
    expect(restarted.experiments.run(run.id).status).toBe('interrupted');
    expect(restarted.experiments.get(id).status).toBe('interrupted');
    expect(() => restarted.experiments.claim(id, 'retry')).toThrow(
      /reconciliation/,
    );
    restarted.experiments.reconcile(
      id,
      'Workspace inspected; previous evaluator is not running.',
    );
    expect(restarted.experiments.claim(id, 'retry').experiment.status).toBe(
      'claimed',
    );
  });

  it('requires an explicit non-Git copy and never evaluates the original', async () => {
    const { app, repository, project, paper, plan } = await fixture(false);
    app.plans.approve(plan.id, plan.fingerprint);
    const request = { documentId: paper.id, planId: plan.id };
    expect(() => app.experiments.create(project.id, request)).toThrow(/copy/);
    expect(() =>
      app.experiments.create(project.id, {
        ...request,
        isolatedCopy: repository,
      }),
    ).toThrow(/separate/);
    const copy = mkdtempSync(join(tmpdir(), 'paperloop-explicit-copy-'));
    writeFileSync(join(copy, 'evaluate.py'), evaluator);
    writeFileSync(join(copy, 'score.txt'), '8');
    const detail = app.experiments.create(project.id, {
      ...request,
      isolatedCopy: copy,
    });
    const run = await settle(
      app,
      app.experiments.startRun(detail.experiment.id, 'baseline').id,
    );
    expect(run.result?.metrics[0]?.value).toBe(8);
    expect(readFileSync(join(repository, 'score.txt'), 'utf8')).toBe('10');
  });

  it('computes regression, no-change, zero-baseline, insufficient samples and provenance distinctions', async () => {
    const { app, project, paper, plan } = await fixture();
    app.plans.approve(plan.id, plan.fingerprint);
    const id = app.experiments.create(project.id, {
      documentId: paper.id,
      planId: plan.id,
    }).experiment.id;
    const external = (role: 'baseline' | 'candidate', value: number) =>
      app.experiments.importResult(
        id,
        role,
        'declared-agent',
        'declared-code',
        {
          schemaVersion: 1,
          metrics: [{ name: 'score', value, unit: 'points' }],
          artifacts: [],
        },
      );
    const baseline = external('baseline', 0);
    const candidate = external('candidate', 2);
    expect(
      app.experiments.compare(id, baseline.id, candidate.id),
    ).toMatchObject({
      outcome: 'improvement',
      metrics: [{ percentChange: null }],
    });
    expect(
      app.experiments.compare(id, baseline.id, external('candidate', -1).id)
        .outcome,
    ).toBe('regression');
    expect(
      app.experiments.compare(id, baseline.id, external('candidate', 0.5).id)
        .outcome,
    ).toBe('no_meaningful_change');
    const harness = await settle(
      app,
      app.experiments.startRun(id, 'baseline').id,
    );
    expect(app.experiments.compare(id, harness.id, candidate.id)).toMatchObject(
      {
        outcome: 'inconclusive',
        reasons: expect.arrayContaining([
          'Harness and externally reported evidence have different provenance.',
        ]),
      },
    );
    const missing = app.experiments.importResult(
      id,
      'candidate',
      'declared-agent',
      'declared-code',
      {
        schemaVersion: 1,
        metrics: [{ name: 'other', value: 2, unit: 'points' }],
        artifacts: [],
      },
    );
    expect(app.experiments.compare(id, baseline.id, missing.id).outcome).toBe(
      'inconclusive',
    );
    app.database.db
      .update(evaluationRuns)
      .set({
        payload: { ...candidate, environmentIdentity: 'different-environment' },
      })
      .where(eq(evaluationRuns.id, candidate.id))
      .run();
    expect(app.experiments.compare(id, baseline.id, candidate.id).outcome).toBe(
      'inconclusive',
    );
  });

  it('enforces sample requirements, guardrails, and one active implementation per project', async () => {
    const { app, project, paper } = await fixture();
    const configuration = draft();
    configuration.metrics[0]!.minimumSamples = 2;
    configuration.metrics.push({
      name: 'latency',
      unit: 'ms',
      direction: 'decrease',
      minimumImprovement: 0,
      maximumRegression: 1,
      minimumSamples: 1,
      guardrail: true,
    });
    const plan = app.plans.draft(project.id, configuration);
    app.plans.approve(plan.id, plan.fingerprint);
    const id = app.experiments.create(project.id, {
      documentId: paper.id,
      planId: plan.id,
    }).experiment.id;
    const other = app.plans.draft(project.id, draft());
    app.plans.approve(other.id, other.fingerprint);
    const otherId = app.experiments.create(project.id, {
      documentId: paper.id,
      planId: other.id,
    }).experiment.id;
    const claim = app.experiments.claim(id, 'owner').experiment;
    expect(() => app.experiments.claim(otherId, 'competitor')).toThrow(
      /Another implementation/,
    );
    app.experiments.progress(
      id,
      claim.claimToken!,
      'Implementation ready',
      true,
    );
    const external = (
      role: 'baseline' | 'candidate',
      value: number,
      latency: number,
      samples: number[],
    ) =>
      app.experiments.importResult(id, role, 'agent', 'code', {
        schemaVersion: 1,
        metrics: [
          { name: 'score', value, unit: 'points', samples },
          { name: 'latency', value: latency, unit: 'ms' },
        ],
        artifacts: [],
      });
    const baseline = external('baseline', 10, 5, [10, 10]);
    expect(
      app.experiments.compare(
        id,
        baseline.id,
        external('candidate', 12, 5, [12]).id,
      ).outcome,
    ).toBe('inconclusive');
    expect(
      app.experiments.compare(
        id,
        baseline.id,
        external('candidate', 12, 7, [12, 12]).id,
      ),
    ).toMatchObject({
      outcome: 'regression',
      metrics: [
        { name: 'score', passed: true },
        { name: 'latency', guardrail: true, passed: false },
      ],
    });
  });
});

describe('real subprocess evaluation failure paths', () => {
  it('passes literal arguments without a shell, omits unreferenced secrets, and reports spawn failures', async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), 'paperloop-literal-arguments-'),
    );
    const configuration = draft();
    configuration.command.arguments = [
      '-c',
      'import json,os,pathlib,sys; assert sys.argv[1] == "literal;$(echo unsafe)"; assert "PAPERLOOP_UNREFERENCED_TEST_SECRET" not in os.environ; pathlib.Path("result.json").write_text(json.dumps({"schemaVersion":1,"metrics":[{"name":"score","unit":"points","value":3}]}))',
      'literal;$(echo unsafe)',
    ];
    const plan = {
      id: randomUUID(),
      projectId: randomUUID(),
      version: 1,
      configuration,
      fingerprint: 'fixture',
      approvedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    process.env.PAPERLOOP_UNREFERENCED_TEST_SECRET = 'must-not-be-inherited';
    try {
      expect(
        await executePlan(plan, workspace, join(workspace, 'literal-logs'))
          .done,
      ).toMatchObject({
        status: 'completed',
        result: { metrics: [{ value: 3 }] },
      });
    } finally {
      delete process.env.PAPERLOOP_UNREFERENCED_TEST_SECRET;
    }
    const missing = {
      ...plan,
      configuration: {
        ...configuration,
        command: {
          ...configuration.command,
          executable: '/paperloop-missing-executable',
        },
      },
    };
    expect(
      await executePlan(missing, workspace, join(workspace, 'spawn-logs')).done,
    ).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('ENOENT'),
    });
  });
  it.each([
    [
      'nonzero exit',
      'import sys; print("failure detail", file=sys.stderr); sys.exit(7)',
      'failed',
    ],
    [
      'malformed JSON',
      'import pathlib; pathlib.Path("result.json").write_text("not json")',
      'failed',
    ],
    ['missing result', 'print("no evidence")', 'failed'],
    ['timeout', 'import time; time.sleep(10)', 'timed_out'],
    [
      'wrong schema',
      'import pathlib; pathlib.Path("result.json").write_text("{\\"schemaVersion\\":2}")',
      'failed',
    ],
  ])(
    '%s is durable and never accepted as evidence',
    async (_name, script, expected) => {
      const workspace = mkdtempSync(join(tmpdir(), 'paperloop-runner-'));
      writeFileSync(join(workspace, 'evaluate.py'), script);
      const configuration = draft(
        'evaluate.py',
        expected === 'timed_out' ? 150 : 2000,
      );
      const plan = {
        id: randomUUID(),
        projectId: randomUUID(),
        version: 1,
        configuration,
        fingerprint: 'fixture',
        approvedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      const execution = executePlan(
        plan,
        workspace,
        join(workspace, 'evidence'),
      );
      expect(await execution.done).toMatchObject({
        status: expected,
        result: null,
        error: expect.any(String),
        artifacts: ['stdout.log', 'stderr.log'],
      });
    },
  );

  it('rejects stale results and escaping artifacts, and cancels a real process group', async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), 'paperloop-runner-boundaries-'),
    );
    const plan = {
      id: randomUUID(),
      projectId: randomUUID(),
      version: 1,
      configuration: draft(),
      fingerprint: 'fixture',
      approvedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(
      join(workspace, 'result.json'),
      JSON.stringify({
        schemaVersion: 1,
        metrics: [{ name: 'score', unit: 'points', value: 1 }],
        artifacts: [],
      }),
    );
    writeFileSync(
      join(workspace, 'evaluate.py'),
      'print("unchanged evidence")',
    );
    expect(
      await executePlan(plan, workspace, join(workspace, 'logs1')).done,
    ).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('stale'),
    });
    writeFileSync(
      join(workspace, 'evaluate.py'),
      'import json,pathlib; pathlib.Path("result.json").write_text(json.dumps({"schemaVersion":1,"metrics":[{"name":"score","unit":"points","value":1}],"artifacts":["../escape"]}))',
    );
    expect(
      await executePlan(plan, workspace, join(workspace, 'logs2')).done,
    ).toMatchObject({ status: 'failed' });
    writeFileSync(
      join(workspace, 'evaluate.py'),
      'import subprocess,time,pathlib; child=subprocess.Popen(["/usr/bin/python3","-c","import time; time.sleep(20)"]); pathlib.Path("child.pid").write_text(str(child.pid)); time.sleep(20)',
    );
    const running = executePlan(
      { ...plan, configuration: draft('evaluate.py', 5000) },
      workspace,
      join(workspace, 'logs3'),
    );
    for (
      let attempt = 0;
      attempt < 100 && !existsSync(join(workspace, 'child.pid'));
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    running.cancel();
    expect(await running.done).toMatchObject({
      status: 'cancelled',
      result: null,
    });
    const pid = Number(readFileSync(join(workspace, 'child.pid'), 'utf8'));
    expect(pid).toBeGreaterThan(0);
    // done now confirms no live group member; unreaped zombies are harmless.
    let state = '';
    try {
      state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2]!;
    } catch {
      /* Reaped. */
    }
    expect(['', 'Z']).toContain(state);
  });

  it.each(['cancelled', 'timed_out'] as const)(
    'confirms %s for a SIGTERM-resistant descendant with detached output',
    async (expected) => {
      const workspace = mkdtempSync(
        join(tmpdir(), 'paperloop-resistant-descendant-'),
      );
      writeFileSync(
        join(workspace, 'descendant.py'),
        `import os,pathlib,signal,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
pathlib.Path('descendant.pid').write_text(str(os.getpid()))
time.sleep(20)
`,
      );
      writeFileSync(
        join(workspace, 'evaluate.py'),
        `import pathlib,subprocess,time
subprocess.Popen(['/usr/bin/python3','descendant.py'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
while not pathlib.Path('descendant.pid').exists(): time.sleep(0.005)
pathlib.Path('ready').write_text('ready')
time.sleep(20)
`,
      );
      const plan = {
        id: randomUUID(),
        projectId: randomUUID(),
        version: 1,
        configuration: draft(
          'evaluate.py',
          expected === 'timed_out' ? 500 : 5000,
        ),
        fingerprint: 'fixture',
        approvedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      const execution = executePlan(plan, workspace, join(workspace, 'logs'));
      cleanup.push(async () => {
        execution.cancel();
        await execution.done;
      });
      if (expected === 'cancelled') {
        for (
          let attempt = 0;
          attempt < 100 && !existsSync(join(workspace, 'ready'));
          attempt++
        )
          await new Promise((resolve) => setTimeout(resolve, 20));
        expect(existsSync(join(workspace, 'ready'))).toBe(true);
        execution.cancel();
        execution.cancel(); // Repeated requests must not arm stale timers.
      }
      expect(await execution.done).toMatchObject({
        status: expected,
        result: null,
      });
      const pid = Number(
        readFileSync(join(workspace, 'descendant.pid'), 'utf8'),
      );
      expect(pid).toBeGreaterThan(0);
      let state = '';
      try {
        state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2]!;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      expect(['', 'Z', 'X']).toContain(state);
      execution.cancel(); // Completion must make later cancellation a no-op.
    },
  );
});
