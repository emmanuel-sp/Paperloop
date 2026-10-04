import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
const relativePath = text.refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  'Use a path within the isolated workspace.',
);
export const metricCriterionSchema = z
  .object({
    name: text,
    unit: text,
    direction: z.enum(['increase', 'decrease']),
    minimumImprovement: z.number().finite().nonnegative(),
    maximumRegression: z.number().finite().nonnegative(),
    minimumSamples: z.number().int().positive().max(10000).default(1),
    guardrail: z.boolean().default(false),
  })
  .strict();
export const legacyEvaluationPlanDraftSchema = z
  .object({
    name: text,
    datasetIdentity: text,
    cases: z.array(text).min(1).max(1000),
    metrics: z
      .array(metricCriterionSchema)
      .min(1)
      .max(100)
      .refine(
        (metrics) =>
          new Set(metrics.map((m) => m.name)).size === metrics.length,
        'Metric names must be unique.',
      ),
    command: z
      .object({
        executable: text,
        arguments: z.array(z.string().max(10000)).max(100),
        workingDirectory: relativePath.default('.'),
        resultPath: relativePath,
        timeoutMs: z.number().int().min(100).max(3600000),
        environmentReferences: z
          .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
          .max(50)
          .default([]),
      })
      .strict(),
    environmentIdentity: text,
  })
  .strict();
const suiteRelativePath = relativePath.refine(
  (value) =>
    !/^(?:[A-Za-z]:|\\\\)/.test(value) &&
    !value.includes('\\') &&
    !value.includes('\0'),
  'Use a relative workspace path with forward slashes.',
);
const checkId = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/);
const uniqueIds = z
  .array(checkId)
  .max(50)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Identifiers must be unique.',
  );
export const suiteReportSchema = z.discriminatedUnion('adapter', [
  z
    .object({ adapter: z.literal('exit-code'), adapterVersion: z.literal(1) })
    .strict(),
  z
    .object({
      adapter: z.literal('junit'),
      adapterVersion: z.literal(1),
      path: suiteRelativePath,
    })
    .strict(),
  z
    .object({
      adapter: z.literal('metrics-v1'),
      adapterVersion: z.literal(1),
      path: suiteRelativePath,
      cases: z
        .object({
          adapter: z.literal('cases-v1'),
          adapterVersion: z.literal(1),
          path: suiteRelativePath,
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
export const suiteCheckSchema = z
  .object({
    id: checkId,
    name: text,
    group: text,
    required: z.boolean(),
    dependsOn: uniqueIds.default([]),
    command: legacyEvaluationPlanDraftSchema.shape.command
      .omit({ resultPath: true })
      .extend({ workingDirectory: suiteRelativePath.default('.') }),
    report: suiteReportSchema,
    metrics: z
      .array(metricCriterionSchema)
      .max(100)
      .default([])
      .refine(
        (metrics) =>
          new Set(metrics.map((m) => m.name)).size === metrics.length,
        'Metric names must be unique within a check.',
      ),
    datasetIdentity: text.optional(),
    environmentIdentity: text.optional(),
    coverage: z
      .object({
        suiteIds: z
          .array(text)
          .max(100)
          .default([])
          .refine(
            (ids) => new Set(ids).size === ids.length,
            'Suite identities must be unique.',
          ),
        minimumCases: z.number().int().min(1).max(10000),
        identityPolicy: z.literal('stable-id'),
        skippedCases: z.enum(['unknown', 'allow']).default('unknown'),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((check, ctx) => {
    if (check.metrics.length && check.report.adapter !== 'metrics-v1')
      ctx.addIssue({
        code: 'custom',
        message: 'Metric criteria require a metrics-v1 report.',
        path: ['metrics'],
      });
    if (
      check.coverage &&
      (check.report.adapter === 'exit-code' ||
        (check.report.adapter === 'metrics-v1' && !check.report.cases))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Coverage requires a case report.',
        path: ['coverage'],
      });
  });
export function freezeEvaluationConfiguration<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value))
      freezeEvaluationConfiguration(child);
    Object.freeze(value);
  }
  return value;
}
export const evaluationSuiteDraftSchema = z
  .object({
    formatVersion: z.literal(2),
    name: text,
    datasetIdentity: text,
    environmentIdentity: text,
    overallTimeoutMs: z.number().int().min(100).max(3600000),
    checks: z.array(suiteCheckSchema).min(1).max(50),
  })
  .strict()
  .superRefine((suite, ctx) => {
    const seen = new Set<string>();
    suite.checks.forEach((check, index) => {
      if (seen.has(check.id))
        ctx.addIssue({
          code: 'custom',
          message: 'Check IDs must be unique.',
          path: ['checks', index, 'id'],
        });
      for (const dependency of check.dependsOn)
        if (!seen.has(dependency) || dependency === check.id)
          ctx.addIssue({
            code: 'custom',
            message: 'Dependencies must refer to earlier checks.',
            path: ['checks', index, 'dependsOn'],
          });
      seen.add(check.id);
    });
    if (new TextEncoder().encode(JSON.stringify(suite)).length > 262144)
      ctx.addIssue({
        code: 'custom',
        message: 'Suite configuration exceeds 256 KB.',
      });
  });
export type EvaluationSuiteDraft = z.infer<typeof evaluationSuiteDraftSchema>;
export type LegacyEvaluationPlanDraft = z.infer<
  typeof legacyEvaluationPlanDraftSchema
>;
export const evaluationPlanDraftSchema = z.union([
  legacyEvaluationPlanDraftSchema,
  evaluationSuiteDraftSchema,
]);
export function isEvaluationSuite(
  value: EvaluationPlanDraft,
): value is EvaluationSuiteDraft {
  return 'formatVersion' in value && value.formatVersion === 2;
}
export type EvaluationPlanDraft = z.infer<typeof evaluationPlanDraftSchema>;
export const evaluationPlanSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  version: z.number().int().positive(),
  configuration: evaluationPlanDraftSchema,
  fingerprint: z.string(),
  approvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type EvaluationPlan = z.infer<typeof evaluationPlanSchema>;
export const legacyEvaluationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    metrics: z
      .array(
        z
          .object({
            name: text,
            value: z.number().finite(),
            unit: text,
            samples: z.array(z.number().finite()).min(1).max(10000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (metrics) =>
          new Set(metrics.map((m) => m.name)).size === metrics.length,
        'Metric names must be unique.',
      ),
    artifacts: z.array(relativePath).max(100).default([]),
  })
  .strict();
export const suiteCheckStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'unknown',
  'skipped',
  'timed_out',
  'cancelled',
  'interrupted',
]);
export const suiteCheckResultSchema = z
  .object({
    checkId,
    status: suiteCheckStatusSchema,
    exitCode: z.number().int().nullable(),
    evidenceStatus: z.enum([
      'valid',
      'not_produced',
      'missing',
      'malformed',
      'stale',
      'exceeds_limit',
    ]),
    reason: text.optional(),
    blockedBy: uniqueIds.default([]),
    metrics: z
      .array(legacyEvaluationResultSchema.shape.metrics.element)
      .max(100)
      .default([])
      .refine(
        (metrics) =>
          new Set(metrics.map((m) => m.name)).size === metrics.length,
        'Metric names must be unique.',
      ),
    caseCoverage: z.enum(['complete', 'partial', 'unknown']),
    caseCount: z.number().int().nonnegative().max(10000).nullable(),
    artifactReferences: z.array(text).max(100).default([]),
  })
  .strict();
export const evaluationSuiteResultSchema = z
  .object({
    schemaVersion: z.literal(2),
    requiredValidation: z.enum(['passed', 'failed', 'unknown']),
    checks: z.array(suiteCheckResultSchema).min(1).max(50),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (
      new Set(result.checks.map((check) => check.checkId)).size !==
      result.checks.length
    )
      ctx.addIssue({ code: 'custom', message: 'Check IDs must be unique.' });
    if (
      result.checks.reduce((sum, check) => sum + (check.caseCount ?? 0), 0) >
      50000
    )
      ctx.addIssue({ code: 'custom', message: 'Run exceeds 50,000 cases.' });
  });
export const evaluationResultSchema = z.union([
  legacyEvaluationResultSchema,
  evaluationSuiteResultSchema,
]);
export type LegacyEvaluationResult = z.infer<
  typeof legacyEvaluationResultSchema
>;
export type SuiteCheckResult = z.infer<typeof suiteCheckResultSchema>;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const workspaceObservationSchema = z
  .object({
    status: z.enum(['observed', 'unavailable']),
    identity: sha256.nullable(),
    revision: z.string().min(1).max(200).nullable(),
    scope: z.literal(
      'workspace-without-git-dependencies-and-approved-reports-v1',
    ),
    exclusionFingerprint: sha256,
    files: z.number().int().nonnegative().max(10000),
    bytes: z.number().int().nonnegative().max(50000000),
    lockfiles: z
      .array(z.object({ path: z.string().min(1).max(500), sha256 }).strict())
      .max(50),
    reason: text.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.status === 'observed') !== (value.identity !== null))
      ctx.addIssue({
        code: 'custom',
        message:
          'Only a complete observation may declare a workspace identity.',
      });
    if (value.status === 'unavailable' && !value.reason)
      ctx.addIssue({
        code: 'custom',
        message: 'Unavailable observations require an explanation.',
      });
  });
export type WorkspaceObservation = z.infer<typeof workspaceObservationSchema>;
const workspaceObservationsSchema = z
  .object({
    before: workspaceObservationSchema,
    after: workspaceObservationSchema.nullable(),
  })
  .strict();
export const suiteExecutionProvenanceSchema = workspaceObservationsSchema
  .extend({
    datasetVerification: z.literal('declared'),
    environmentVerification: z.literal('declared'),
    observerRuntime: z
      .object({ node: text, platform: text, architecture: text })
      .strict(),
    authorization: z
      .object({
        mode: z.enum(['manual', 'automation']),
        attemptNumber: z.number().int().positive(),
        maxRuns: z.number().int().positive().nullable(),
      })
      .strict(),
  })
  .superRefine((value, ctx) => {
    const budget = value.authorization;
    if (
      (budget.mode === 'automation') !== (budget.maxRuns !== null) ||
      (budget.maxRuns !== null && budget.attemptNumber > budget.maxRuns)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Automation attempts require their retained run ceiling; manual attempts have no automation ceiling.',
      });
  });
export type SuiteExecutionProvenance = z.infer<
  typeof suiteExecutionProvenanceSchema
>;
export const suiteCheckRecordSchema = z
  .object({
    runId: z.uuid(),
    ordinal: z.number().int().nonnegative().max(49),
    specification: suiteCheckSchema,
    specificationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    datasetIdentity: text,
    environmentIdentity: text,
    producerIdentity: text,
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    logsTruncated: z.boolean().default(false),
    workspaceObservations: workspaceObservationsSchema.optional(),
    result: suiteCheckResultSchema,
  })
  .strict()
  .refine(
    (record) => record.specification.id === record.result.checkId,
    'Check specification and result IDs must match.',
  );
export type SuiteCheckRecord = z.infer<typeof suiteCheckRecordSchema>;
export const suiteCaseSchema = z
  .object({
    id: z.string().min(1).max(500),
    label: text,
    suiteId: text.optional(),
    status: z.enum(['passed', 'failed', 'skipped', 'unknown']),
    identityStatus: z.enum(['stable', 'ambiguous']).default('stable'),
    rawIdentifiers: z.array(z.string().max(2000)).max(10).default([]),
    metrics: z
      .array(
        legacyEvaluationResultSchema.shape.metrics.element.omit({
          samples: true,
        }),
      )
      .max(100)
      .default([])
      .refine(
        (metrics) =>
          new Set(metrics.map((m) => m.name)).size === metrics.length,
        'Metric names must be unique.',
      ),
    reason: text.optional(),
  })
  .strict();
export type SuiteCase = z.infer<typeof suiteCaseSchema>;
export const suiteCasesReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetIdentity: text,
    cases: z
      .array(suiteCaseSchema)
      .max(10000)
      .refine(
        (cases) => new Set(cases.map((item) => item.id)).size === cases.length,
        'Case IDs must be unique.',
      ),
  })
  .strict();
export const suiteCasePageRequestSchema = z
  .object({
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(100).default(100),
    status: suiteCaseSchema.shape.status.optional(),
  })
  .strict();
export type SuiteCasePageRequest = z.infer<typeof suiteCasePageRequestSchema>;
export const suiteCasePageSchema = z.object({
  runId: z.uuid(),
  checkId,
  cases: z.array(suiteCaseSchema).max(100),
  total: z.number().int().nonnegative().max(10000),
  nextCursor: z.string().nullable(),
});
export const suiteCheckListSchema = z.object({
  checks: z.array(suiteCheckRecordSchema).max(50),
});
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export const implementationEvidenceSchema = z
  .object({
    summary: z.string().trim().min(1).max(10000),
    changedFiles: z.array(text).max(100).default([]),
    checks: z.array(text).max(50).default([]),
    limitations: z.array(text).max(50).default([]),
  })
  .strict();
export type ImplementationEvidence = z.infer<
  typeof implementationEvidenceSchema
>;

export const experimentRequestSchema = z
  .object({
    documentId: z.uuid(),
    planId: z.uuid(),
    baselineRevision: text.optional(),
    isolatedCopy: text.optional(),
    checkoutPath: text.optional(),
    recommendationId: z.uuid().optional(),
    researchAngle: z.string().trim().max(500).optional(),
  })
  .strict();
export type ExperimentRequest = z.infer<typeof experimentRequestSchema>;
export const experimentSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  documentId: z.uuid(),
  planId: z.uuid(),
  contextId: z.uuid(),
  briefId: z.uuid().nullable(),
  recommendationId: z.uuid().nullable().optional(),
  researchAngle: z.string().max(500).optional(),
  sourceVersion: z.string().nullable().optional(),
  status: z.enum(['pending', 'claimed', 'ready', 'interrupted', 'completed']),
  baselinePath: z.string(),
  candidatePath: z.string(),
  baselineRevision: z.string(),
  claimToken: z.string().nullable(),
  claimOwner: z.string().nullable(),
  claimExpiresAt: z.iso.datetime().nullable(),
  lastAgentCheckIn: z.iso.datetime().nullable().optional(),
  implementationSummary: implementationEvidenceSchema.nullable().optional(),
  progress: z.string(),
  reconciliation: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Experiment = z.infer<typeof experimentSchema>;
export const runSchema = z.object({
  id: z.uuid(),
  experimentId: z.uuid(),
  planId: z.uuid(),
  role: z.enum(['baseline', 'candidate']),
  status: z.enum([
    'running',
    'completed',
    'failed',
    'timed_out',
    'cancelled',
    'interrupted',
  ]),
  producer: z.enum(['harness', 'external']),
  producerIdentity: z.string(),
  codeIdentity: z.string(),
  suiteExecution: suiteExecutionProvenanceSchema.optional(),
  planFingerprint: z.string(),
  datasetIdentity: z.string(),
  environmentIdentity: z.string(),
  result: evaluationResultSchema.nullable(),
  error: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  artifactReferences: z.array(z.string()),
});
export type EvaluationRun = z.infer<typeof runSchema>;
export const comparisonSchema = z.object({
  id: z.uuid(),
  experimentId: z.uuid(),
  baselineRunId: z.uuid(),
  candidateRunId: z.uuid(),
  outcome: z.enum([
    'improvement',
    'regression',
    'no_meaningful_change',
    'inconclusive',
  ]),
  reasons: z.array(z.string()),
  metrics: z.array(
    z.object({
      name: z.string(),
      unit: z.string(),
      baseline: z.number().nullable(),
      candidate: z.number().nullable(),
      delta: z.number().nullable(),
      percentChange: z.number().nullable(),
      guardrail: z.boolean(),
      passed: z.boolean(),
    }),
  ),
  createdAt: z.iso.datetime(),
});
export type Comparison = z.infer<typeof comparisonSchema>;
export const experimentDetailSchema = z.object({
  experiment: experimentSchema,
  plan: evaluationPlanSchema,
  runs: z.array(runSchema),
  comparisons: z.array(comparisonSchema),
  nextActions: z.array(z.string()),
});
export type ExperimentDetail = z.infer<typeof experimentDetailSchema>;
export const evaluationPlanListSchema = z.object({
  plans: z.array(evaluationPlanSchema),
});
export const experimentListSchema = z.object({
  experiments: z.array(experimentSchema),
});
export const artifactContentSchema = z.object({ content: z.string() });

export const evaluationSuggestionSchema = z.object({
  plan: evaluationPlanSchema.nullable(),
  draft: evaluationPlanDraftSchema.nullable(),
  rationale: z.array(z.string()),
  limitations: z.array(z.string()),
  documentId: z.uuid().nullable(),
  documentTitle: z.string().nullable(),
  sourceVersion: z.string().nullable(),
  contextVersion: z.number().int().positive(),
  researchAngle: z.string(),
  recommendationId: z.uuid().nullable(),
});
export type EvaluationSuggestion = z.infer<typeof evaluationSuggestionSchema>;
