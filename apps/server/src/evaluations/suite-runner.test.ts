import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluationSuiteDraftSchema,
  experimentSchema,
  runSchema,
  type EvaluationSuiteDraft,
} from '@paperloop/contracts';
import { createApp } from '../app.js';
import { evaluationRuns, experiments } from '../storage/schema.js';
import * as groups from './process-group.js';
import { executeSuite } from './suite-runner.js';
import {
  assessReport,
  parseCases,
  parseJUnit,
  parseMetrics,
} from './report-adapters.js';
import {
  ARTIFACT_BYTES,
  ArtifactRegistry,
  clearReport,
  readEvidence,
  REPORT_BYTES,
} from './suite-files.js';

type CheckInput = {
  id: string;
  script?: string;
  report?: EvaluationSuiteDraft['checks'][number]['report'];
  dependsOn?: string[];
  timeoutMs?: number;
  required?: boolean;
};
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function fixture(inputs: CheckInput[], overallTimeoutMs = 10000) {
  const root = mkdtempSync(join(tmpdir(), 'paperloop-suite-runner-'));
  const workspace = join(root, 'repo'),
    artifactDirectory = join(root, 'artifacts');
  mkdirSync(workspace);
  const dataDirectory = join(root, 'data');
  const app = createApp({
    logger: false,
    connectionSecret: 'runner-test',
    storage: { dataDirectory },
  });
  cleanups.push(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const project = app.projects.create({
    name: 'Report fixture',
    description: 'Existing repository checks',
    objectives: [],
    constraints: [],
    repository: { kind: 'local', path: workspace },
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
    evaluationSuiteDraftSchema.parse({
      formatVersion: 2,
      name: 'Repository checks',
      datasetIdentity: 'fixture-data',
      environmentIdentity: 'fixture-env',
      overallTimeoutMs,
      checks: inputs.map((input) => ({
        id: input.id,
        name: input.id,
        group: 'Tests',
        required: input.required ?? true,
        dependsOn: input.dependsOn ?? [],
        command: {
          executable: process.execPath,
          arguments: ['-e', input.script ?? ''],
          timeoutMs: input.timeoutMs ?? 5000,
        },
        report: input.report ?? { adapter: 'exit-code', adapterVersion: 1 },
      })),
    }),
  );
  const approved = app.plans.approve(plan.id, plan.fingerprint);
  const experiment = experimentSchema.parse({
    id: randomUUID(),
    projectId: project.id,
    documentId: paper.id,
    planId: plan.id,
    contextId: project.currentContext.id,
    briefId: null,
    status: 'ready',
    baselinePath: workspace,
    candidatePath: workspace,
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
    producerIdentity: 'controlled-runner',
    codeIdentity: 'fixture',
    planFingerprint: plan.fingerprint,
    datasetIdentity: 'fixture-data',
    environmentIdentity: 'fixture-env',
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
  return {
    app,
    workspace,
    artifactDirectory,
    root,
    run,
    plan: approved,
    options: {
      plan: approved,
      runId: run.id,
      workspace,
      artifactDirectory,
      evidence: app.experiments.evidence,
      authorize() {},
    },
  };
}
const junit = {
  adapter: 'junit',
  adapterVersion: 1,
  path: 'reports/tests.xml',
} as const;
const reportScript = (xml: string, extra = '') =>
  `const fs=require('node:fs');fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/tests.xml',${JSON.stringify(xml)});${extra}`;
const xml = (status = '') =>
  `<testsuite name="unit" tests="1"><testcase name="one" classname="repo">${status}</testcase></testsuite>`;
const bytes = (value: string) => Buffer.from(value);

describe('existing repository report adapters', () => {
  it('keeps stable case identifiers across ordering and marks duplicate identities ambiguous', () => {
    const first = parseJUnit(
      bytes(
        '<testsuite name="unit"><testcase name="a &amp; b"/><testcase name="c"/></testsuite>',
      ),
    );
    const second = parseJUnit(
      bytes(
        '<testsuite name="unit"><testcase name="c"/><testcase name="a &amp; b"/></testsuite>',
      ),
    );
    expect(first.cases[0]!.label).toBe('a & b');
    expect(first.cases[0]!.id).toBe(second.cases[1]!.id);
    expect(
      parseJUnit(
        bytes(
          '<testsuite name="unit"><testcase name="a"/><testcase name="a"/></testsuite>',
        ),
      ).cases.map((item) => item.identityStatus),
    ).toEqual(['ambiguous', 'ambiguous']);
  });
  it.each([
    ['empty report', '<testsuite name="unit" tests="0"/>'],
    [
      'inconsistent totals',
      '<testsuite tests="2"><testcase name="a"/></testsuite>',
    ],
    ['malformed XML', '<testsuite><testcase></testsuite>'],
    [
      'DTD',
      '<!DOCTYPE testsuite [<!ENTITY secret SYSTEM "file:///etc/passwd">]><testsuite><testcase name="a"/></testsuite>',
    ],
    ['conflicting outcomes', xml('<failure/><skipped/>')],
    [
      'unsupported explicit status',
      '<testsuite><testcase name="a" status="notrun"/></testsuite>',
    ],
    ['extra root', '<other/><testsuite><testcase name="a"/></testsuite>'],
    [
      'excessive nesting',
      '<testsuite>'.repeat(34) +
        '<testcase name="a"/>' +
        '</testsuite>'.repeat(34),
    ],
  ])('rejects %s instead of reporting success', (_name, report) => {
    expect(() => parseJUnit(bytes(report))).toThrow();
  });
  it('requires the explicitly registered case format and matching dataset', () => {
    expect(() =>
      parseCases(bytes(JSON.stringify({ cases: ['unregistered'] })), 'data'),
    ).toThrow(/cases-v1/);
    expect(() =>
      parseCases(
        bytes(
          JSON.stringify({
            schemaVersion: 1,
            datasetIdentity: 'other',
            cases: [{ id: 'a', label: 'a', status: 'passed' }],
          }),
        ),
        'data',
      ),
    ).toThrow(/dataset/);
  });
  it('checks metric units and sample counts without converting a score into test success', () => {
    const config = evaluationSuiteDraftSchema.parse({
      formatVersion: 2,
      name: 'Metrics',
      datasetIdentity: 'd',
      environmentIdentity: 'e',
      overallTimeoutMs: 1000,
      checks: [
        {
          id: 'metric',
          name: 'metric',
          group: 'benchmark',
          required: false,
          command: { executable: 'node', arguments: [], timeoutMs: 1000 },
          report: {
            adapter: 'metrics-v1',
            adapterVersion: 1,
            path: 'metrics.json',
          },
          metrics: [
            {
              name: 'score',
              unit: 'n',
              direction: 'increase',
              minimumImprovement: 1,
              maximumRegression: 0,
              minimumSamples: 2,
            },
          ],
        },
      ],
    });
    const check = config.checks[0]!;
    expect(() =>
      parseMetrics(
        bytes(
          JSON.stringify({
            schemaVersion: 1,
            metrics: [{ name: 'score', unit: 'n', value: 2 }],
            artifacts: [],
          }),
        ),
        check,
      ),
    ).toThrow(/insufficient/);
    const parsed = parseMetrics(
      bytes(
        JSON.stringify({
          schemaVersion: 1,
          metrics: [{ name: 'score', unit: 'n', value: 2, samples: [1, 3] }],
          artifacts: [],
        }),
      ),
      check,
    );
    expect(assessReport(check, parsed)).toMatchObject({
      status: 'passed',
      caseCoverage: 'unknown',
      caseCount: null,
    });
  });
  it('treats skipped cases as unknown unless the exact check allows them', () => {
    const f = fixture([{ id: 'unit', report: junit }]);
    const check = (f.plan.configuration as EvaluationSuiteDraft).checks[0]!;
    const parsed = parseJUnit(bytes(xml('<skipped/>')));
    expect(assessReport(check, parsed).status).toBe('unknown');
    expect(
      assessReport(
        {
          ...check,
          coverage: {
            minimumCases: 1,
            suiteIds: [],
            identityPolicy: 'stable-id',
            skippedCases: 'allow',
          },
        },
        parsed,
      ).status,
    ).toBe('passed');
  });
});

describe('serial suite execution', () => {
  it('reads hundreds of cases from a real Node test report with no manually entered cases', async () => {
    const f = fixture([
      {
        id: 'unit',
        script: `require('node:child_process').execFileSync(${JSON.stringify(process.execPath)},['--test','--test-reporter=junit','--test-reporter-destination=reports/tests.xml','existing.test.cjs'],{stdio:'inherit'})`,
        report: junit,
      },
    ]);
    mkdirSync(join(f.workspace, 'reports'));
    writeFileSync(
      join(f.workspace, 'existing.test.cjs'),
      "const test=require('node:test');for(let i=0;i<301;i++)test('repo case '+i,()=>{});",
    );
    const result = await executeSuite(f.options).done;
    expect(result).toMatchObject({
      status: 'completed',
      result: {
        requiredValidation: 'passed',
        checks: [
          { status: 'passed', caseCount: 301, caseCoverage: 'complete' },
        ],
      },
    });
    const page = f.app.experiments.evidence.cases(f.run.id, 'unit', {
      limit: 100,
    });
    expect(page.total).toBe(301);
    expect(page.nextCursor).toBeTruthy();
    expect(result.artifacts).toContain('unit--report.xml');
    expect(() => executeSuite(f.options)).toThrow(/cannot resume/);
  });
  it('retains a failing report, skips dependent commands, and still runs independent checks', async () => {
    const f = fixture([
      {
        id: 'unit',
        report: junit,
        script: reportScript(xml('<failure message="bad"/>')),
      },
      {
        id: 'dependent',
        dependsOn: ['unit'],
        script: "require('fs').writeFileSync('should-not-exist','bad')",
      },
      { id: 'independent', script: "require('fs').writeFileSync('ran','yes')" },
    ]);
    const result = await executeSuite(f.options).done;
    expect(result.result.requiredValidation).toBe('failed');
    expect(result.result.checks.map((item) => item.status)).toEqual([
      'failed',
      'skipped',
      'passed',
    ]);
    expect(result.result.checks[1]!.blockedBy).toEqual(['unit']);
    expect(() => readFileSync(join(f.workspace, 'should-not-exist'))).toThrow();
    expect(readFileSync(join(f.workspace, 'ran'), 'utf8')).toBe('yes');
    expect(
      f.app.experiments.evidence.cases(f.run.id, 'unit', { limit: 100 })
        .cases[0]!.status,
    ).toBe('failed');
  });
  it('never accepts a passing report when the command exits nonzero', async () => {
    const f = fixture([
      {
        id: 'unit',
        report: junit,
        script: reportScript(xml(), 'process.exitCode=3;'),
      },
    ]);
    const result = await executeSuite(f.options).done;
    expect(result.result.checks[0]).toMatchObject({
      status: 'failed',
      exitCode: 3,
      evidenceStatus: 'valid',
      caseCount: 1,
    });
  });
  it.each([
    ['missing', '', 'missing'],
    ['empty', reportScript('<testsuite tests="0"/>'), 'malformed'],
    [
      'stale',
      reportScript(
        xml(),
        "fs.utimesSync('reports/tests.xml',new Date(0),new Date(0));",
      ),
      'stale',
    ],
    ['oversized', reportScript('x'.repeat(REPORT_BYTES + 1)), 'exceeds_limit'],
    [
      'symlink',
      "require('fs').mkdirSync('reports');require('fs').symlinkSync('/etc/passwd','reports/tests.xml')",
      'malformed',
    ],
  ])(
    'reports %s evidence as unknown',
    async (_name, script, evidenceStatus) => {
      // Large reports are generated in the child, not passed as oversized argv.
      if (evidenceStatus === 'exceeds_limit')
        script =
          "const fs=require('fs');fs.mkdirSync('reports');fs.writeFileSync('reports/tests.xml','x'.repeat(2000001));";
      const f = fixture([{ id: 'unit', report: junit, script }]);
      const result = await executeSuite(f.options).done;
      expect(result.result.checks[0]).toMatchObject({
        status: 'unknown',
        evidenceStatus,
      });
      expect(result.result.requiredValidation).toBe('unknown');
    },
  );
  it('removes old reports before dispatch and never reuses them', async () => {
    const f = fixture([{ id: 'unit', report: junit }]);
    mkdirSync(join(f.workspace, 'reports'));
    writeFileSync(join(f.workspace, 'reports/tests.xml'), xml());
    const result = await executeSuite(f.options).done;
    expect(result.result.checks[0]).toMatchObject({
      status: 'unknown',
      evidenceStatus: 'missing',
    });
  });
  it('persists metrics and only explicitly registered sidecar cases', async () => {
    const script =
      "const fs=require('fs');fs.writeFileSync('metrics.json',JSON.stringify({schemaVersion:1,metrics:[{name:'score',unit:'n',value:2}],artifacts:['cases.json']}));fs.writeFileSync('cases.json',JSON.stringify({schemaVersion:1,datasetIdentity:'fixture-data',cases:[{id:'real-case',label:'Real case',status:'passed'}]}));";
    const f = fixture([
      {
        id: 'raw',
        script,
        report: {
          adapter: 'metrics-v1',
          adapterVersion: 1,
          path: 'metrics.json',
        },
      },
      {
        id: 'registered',
        script,
        report: {
          adapter: 'metrics-v1',
          adapterVersion: 1,
          path: 'metrics.json',
          cases: { adapter: 'cases-v1', adapterVersion: 1, path: 'cases.json' },
        },
      },
    ]);
    const result = await executeSuite(f.options).done;
    expect(result.result.checks.map((item) => item.caseCount)).toEqual([
      null,
      1,
    ]);
    expect(
      f.app.experiments.evidence.cases(f.run.id, 'raw', { limit: 100 }).total,
    ).toBe(0);
    expect(
      f.app.experiments.evidence.cases(f.run.id, 'registered', { limit: 100 })
        .total,
    ).toBe(1);
  });
  it('stops a resistant descendant before a later command starts', async () => {
    const f = fixture([
      {
        id: 'tree',
        script: `const {spawn}=require('child_process');const child=spawn(${JSON.stringify(process.execPath)},['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});require('fs').writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000);`,
        timeoutMs: 500,
      },
      { id: 'later' },
    ]);
    const result = await executeSuite(f.options).done;
    expect(result.result.checks.map((item) => item.status)).toEqual([
      'timed_out',
      'passed',
    ]);
    const pid = Number(readFileSync(join(f.workspace, 'child.pid'), 'utf8'));
    expect(
      await groups.confirmProcessGroupStopped(pid, async () => {
        // The child's group is its approved parent's group; inspect the child's
        // state directly to assert the fixture cannot continue executing.
        const { execFileSync } = await import('node:child_process');
        try {
          const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], {
            encoding: 'utf8',
          }).trim();
          return state ? `${pid} ${state}` : '';
        } catch {
          return '';
        }
      }),
    ).toBe(true);
  });
  it('keeps a known case failure when an additional artifact is missing', async () => {
    const script =
      "const fs=require('fs');fs.writeFileSync('metrics.json',JSON.stringify({schemaVersion:1,metrics:[{name:'score',unit:'n',value:2}],artifacts:['missing.txt']}));fs.writeFileSync('cases.json',JSON.stringify({schemaVersion:1,datasetIdentity:'fixture-data',cases:[{id:'bad',label:'bad',status:'failed'}]}));";
    const f = fixture([
      {
        id: 'metric',
        script,
        report: {
          adapter: 'metrics-v1',
          adapterVersion: 1,
          path: 'metrics.json',
          cases: { adapter: 'cases-v1', adapterVersion: 1, path: 'cases.json' },
        },
      },
    ]);
    const result = await executeSuite(f.options).done;
    expect(result.result).toMatchObject({
      requiredValidation: 'failed',
      checks: [{ status: 'failed', evidenceStatus: 'missing', caseCount: 1 }],
    });
    expect(
      f.app.experiments.evidence.cases(f.run.id, 'metric', { limit: 100 })
        .total,
    ).toBe(1);
  });
  it('preserves a nonzero command failure even when its report is missing', async () => {
    const f = fixture([
      { id: 'unit', report: junit, script: 'process.exit(2)' },
    ]);
    expect((await executeSuite(f.options).done).result).toMatchObject({
      requiredValidation: 'failed',
      checks: [{ status: 'failed', evidenceStatus: 'missing' }],
    });
  });
  it('continues independent checks after a per-check timeout', async () => {
    const f = fixture([
      { id: 'slow', script: 'setInterval(()=>{},1000)', timeoutMs: 100 },
      { id: 'independent' },
    ]);
    const result = await executeSuite(f.options).done;
    expect(result.status).toBe('completed');
    expect(result.result.checks.map((item) => item.status)).toEqual([
      'timed_out',
      'passed',
    ]);
  });
  it('stops dispatch at the overall deadline', async () => {
    const f = fixture(
      [{ id: 'slow', script: 'setInterval(()=>{},1000)' }, { id: 'later' }],
      100,
    );
    const result = await executeSuite(f.options).done;
    expect(result.status).toBe('timed_out');
    expect(result.result.checks[1]!.status).toBe('skipped');
  });
  it('cancels the active group and preserves previously completed case evidence', async () => {
    const f = fixture([
      { id: 'unit', report: junit, script: reportScript(xml()) },
      { id: 'slow', script: "console.log('ready');setInterval(()=>{},1000)" },
      { id: 'later' },
    ]);
    const execution = executeSuite(f.options);
    await vi.waitFor(() =>
      expect(
        f.app.experiments.evidence.checks(f.run.id)[1]?.result.status,
      ).toBe('running'),
    );
    execution.cancel();
    const result = await execution.done;
    expect(result.status).toBe('cancelled');
    expect(result.result.checks.map((item) => item.status)).toEqual([
      'passed',
      'cancelled',
      'skipped',
    ]);
    expect(
      f.app.experiments.evidence.cases(f.run.id, 'unit', { limit: 100 }).total,
    ).toBe(1);
  });
  it('honors live authorization revocation and does not dispatch later checks', async () => {
    const f = fixture([
      { id: 'slow', script: 'setInterval(()=>{},1000)' },
      { id: 'later' },
    ]);
    let enabled = true;
    const execution = executeSuite({
      ...f.options,
      authorize() {
        if (!enabled) throw new Error('Automation disabled.');
      },
    });
    await vi.waitFor(() =>
      expect(
        f.app.experiments.evidence.checks(f.run.id)[0]?.result.status,
      ).toBe('running'),
    );
    enabled = false;
    const result = await execution.done;
    expect(result).toMatchObject({
      status: 'cancelled',
      error: 'Automation disabled.',
    });
    expect(result.result.checks[1]!.status).toBe('skipped');
  });
  it('halts the entire attempt when process termination cannot be confirmed', async () => {
    vi.spyOn(groups, 'confirmProcessGroupStopped').mockResolvedValue(false);
    const f = fixture([{ id: 'unit' }, { id: 'later' }]);
    const result = await executeSuite(f.options).done;
    expect(result.status).toBe('interrupted');
    expect(result.result.checks.map((item) => item.status)).toEqual([
      'interrupted',
      'skipped',
    ]);
  });
  it('bounds logs in bytes and explicitly records truncation', async () => {
    const f = fixture([
      { id: 'verbose', script: "process.stdout.write('🙂'.repeat(400000));" },
    ]);
    const result = await executeSuite(f.options).done;
    expect(result.result.checks[0]!.status).toBe('passed');
    expect(f.app.experiments.evidence.checks(f.run.id)[0]!.logsTruncated).toBe(
      true,
    );
    expect(
      readFileSync(join(f.artifactDirectory, 'verbose--stdout.log')).length,
    ).toBe(1_000_000);
  });
  it('rejects another approved suite before dispatch even if its checks are identical', () => {
    const f = fixture([{ id: 'unit' }]);
    const other = f.app.plans.draft(f.plan.projectId, {
      ...f.plan.configuration,
      name: 'Different suite',
    });
    const approved = f.app.plans.approve(other.id, other.fingerprint);
    expect(() => executeSuite({ ...f.options, plan: approved })).toThrow(
      /active reserved/,
    );
  });
});

describe('bounded evidence files', () => {
  it('rejects symlinked parent directories and prevents stale file reads', () => {
    const f = fixture([{ id: 'unit' }]);
    symlinkSync(f.root, join(f.workspace, 'linked'));
    expect(() =>
      clearReport(f.workspace, f.workspace, 'linked/out.xml'),
    ).toThrow(/symlinks/);
    writeFileSync(join(f.workspace, 'old.xml'), xml());
    utimesSync(join(f.workspace, 'old.xml'), new Date(0), new Date(0));
    expect(() =>
      readEvidence(
        f.workspace,
        f.workspace,
        'old.xml',
        REPORT_BYTES,
        Date.now(),
      ),
    ).toThrow(/predates/);
    expect(() =>
      readEvidence(f.workspace, f.workspace, '../out.xml', REPORT_BYTES),
    ).toThrow(/within/);
  });
  it('enforces aggregate artifact and log budgets without overwriting evidence', () => {
    const f = fixture([{ id: 'unit' }]);
    mkdirSync(f.artifactDirectory);
    const registry = new ArtifactRegistry(f.artifactDirectory),
      block = Buffer.alloc(ARTIFACT_BYTES);
    registry.register('stdout.log', block, true);
    expect(() =>
      registry.register('stderr.log', Buffer.from('x'), true),
    ).toThrow(/bound/);
    for (let i = 0; i < 4; i++) registry.register(`artifact-${i}`, block);
    expect(() => registry.register('overflow', Buffer.from('x'))).toThrow(
      /bound/,
    );
    expect(() => registry.register('stdout.log', Buffer.alloc(0))).toThrow();
    expect(registry.references.length).toBe(5);
  });
});
