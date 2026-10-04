import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluationPlanDraftSchema,
  evaluationSuiteDraftSchema,
  legacyEvaluationPlanDraftSchema,
  evaluationResultSchema,
  suiteCasesReportSchema,
  suiteCasePageRequestSchema,
  freezeEvaluationConfiguration,
  workspaceObservationSchema,
  suiteExecutionProvenanceSchema,
} from './evaluations.js';
import { analysisOutputSchema, submitScheduleJobSchema } from './schedules.js';
const example = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../docs/evaluation-design/examples/ml.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

describe('layered Evaluation contracts', () => {
  it('accepts both design examples and freezes the defaulted v2 executable configuration', () => {
    for (const name of ['ml', 'application']) {
      const suite = freezeEvaluationConfiguration(
        evaluationSuiteDraftSchema.parse(
          JSON.parse(
            readFileSync(
              new URL(
                `../../../docs/evaluation-design/examples/${name}.json`,
                import.meta.url,
              ),
              'utf8',
            ),
          ),
        ),
      );
      expect(Object.isFrozen(suite.checks[0]!.command.arguments)).toBe(true);
      expect(() => {
        suite.checks[0]!.command.arguments.push('unapproved');
      }).toThrow();
      expect(evaluationPlanDraftSchema.parse(suite)).toEqual(suite);
    }
  });
  it('carries suites through analysis and native scheduling without approval', () => {
    const output = { recommendations: [], plans: [example()] };
    expect(analysisOutputSchema.parse(output).plans).toHaveLength(1);
    expect(
      submitScheduleJobSchema.parse({
        token: '4bb0fe0b-2c28-4ea6-b664-e026a343f6d4',
        output,
      }).output.plans,
    ).toHaveLength(1);
  });
  it.each([
    'duplicate',
    'forward',
    'missing',
    'self',
    'unknown-version',
    'adapter-version',
    'absolute-path',
    'windows-path',
    'metric-without-report',
    'coverage-without-cases',
    'too-many',
    'oversize',
  ])('rejects %s rather than falling back to a legacy plan', (kind) => {
    const value = example();
    if (kind === 'duplicate') value.checks[1].id = value.checks[0].id;
    if (kind === 'forward') value.checks[0].dependsOn = ['prediction'];
    if (kind === 'missing') value.checks[0].dependsOn = ['missing'];
    if (kind === 'self') value.checks[0].dependsOn = ['syntax'];
    if (kind === 'unknown-version') value.formatVersion = 3;
    if (kind === 'adapter-version') value.checks[0].report.adapterVersion = 2;
    if (kind === 'absolute-path') value.checks[1].report.path = '/report.xml';
    if (kind === 'windows-path')
      value.checks[0].command.workingDirectory = 'C:\\outside';
    if (kind === 'metric-without-report')
      value.checks[0].metrics = value.checks[2].metrics;
    if (kind === 'coverage-without-cases')
      value.checks[0].coverage = {
        minimumCases: 1,
        identityPolicy: 'stable-id',
      };
    if (kind === 'too-many')
      value.checks = Array.from({ length: 51 }, (_, i) => ({
        ...value.checks[0],
        id: `c${i}`,
      }));
    if (kind === 'oversize')
      value.checks[0].command.arguments = Array.from({ length: 30 }, () =>
        'x'.repeat(10000),
      );
    expect(evaluationPlanDraftSchema.safeParse(value).success).toBe(false);
  });
  it('keeps absent-version legacy parsing unchanged and refuses explicit v1/v2 hybrids', () => {
    const legacy = {
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
    };
    expect(evaluationPlanDraftSchema.parse(legacy)).toEqual(
      legacyEvaluationPlanDraftSchema.parse(legacy),
    );
    expect(
      evaluationPlanDraftSchema.safeParse({ ...legacy, formatVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      evaluationPlanDraftSchema.safeParse({ ...legacy, formatVersion: 2 })
        .success,
    ).toBe(false);
  });
  it('retains missing/partial case evidence explicitly and bounds result membership and paging', () => {
    const check = {
      checkId: 'syntax',
      status: 'unknown',
      exitCode: 0,
      evidenceStatus: 'missing',
      caseCoverage: 'unknown',
      caseCount: null,
    };
    expect(
      evaluationResultSchema.parse({
        schemaVersion: 2,
        requiredValidation: 'unknown',
        checks: [check],
      }),
    ).toMatchObject({ checks: [{ status: 'unknown', metrics: [] }] });
    expect(
      evaluationResultSchema.safeParse({
        schemaVersion: 2,
        requiredValidation: 'passed',
        checks: [check, check],
      }).success,
    ).toBe(false);
    expect(
      suiteCasesReportSchema.safeParse({
        schemaVersion: 1,
        datasetIdentity: 'data',
        cases: [
          { id: 'a', label: 'a', status: 'unknown' },
          { id: 'a', label: 'duplicate', status: 'passed' },
        ],
      }).success,
    ).toBe(false);
    expect(suiteCasePageRequestSchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
  });
});

describe('suite observed provenance boundaries', () => {
  const observed = {
    status: 'observed',
    identity: 'a'.repeat(64),
    revision: null,
    scope: 'workspace-without-git-dependencies-and-approved-reports-v1',
    exclusionFingerprint: 'b'.repeat(64),
    files: 0,
    bytes: 0,
    lockfiles: [],
  };
  it('rejects a claimed complete identity without an observation and unexplained unavailable evidence', () => {
    expect(
      workspaceObservationSchema.safeParse({ ...observed, identity: null })
        .success,
    ).toBe(false);
    expect(
      workspaceObservationSchema.safeParse({
        ...observed,
        status: 'unavailable',
        identity: null,
      }).success,
    ).toBe(false);
    expect(
      workspaceObservationSchema.safeParse({
        ...observed,
        status: 'unavailable',
        identity: null,
        reason: 'Bound exceeded.',
      }).success,
    ).toBe(true);
  });
  it('requires a retained automation ceiling and keeps environment/dataset identities declared', () => {
    const base = {
      before: observed,
      after: null,
      datasetVerification: 'declared',
      environmentVerification: 'declared',
      observerRuntime: {
        node: 'fixture',
        platform: 'fixture',
        architecture: 'fixture',
      },
      authorization: { mode: 'automation', attemptNumber: 2, maxRuns: 2 },
    };
    expect(suiteExecutionProvenanceSchema.safeParse(base).success).toBe(true);
    expect(
      suiteExecutionProvenanceSchema.safeParse({
        ...base,
        authorization: { ...base.authorization, maxRuns: 1 },
      }).success,
    ).toBe(false);
    expect(
      suiteExecutionProvenanceSchema.safeParse({
        ...base,
        authorization: { ...base.authorization, maxRuns: null },
      }).success,
    ).toBe(false);
    expect(
      suiteExecutionProvenanceSchema.safeParse({
        ...base,
        environmentVerification: 'verified',
      }).success,
    ).toBe(false);
  });
});
