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
export const evaluationPlanDraftSchema = z
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
export const evaluationResultSchema = z
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
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export const experimentRequestSchema = z
  .object({
    documentId: z.uuid(),
    planId: z.uuid(),
    baselineRevision: text.optional(),
    isolatedCopy: text.optional(),
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
  status: z.enum(['pending', 'claimed', 'ready', 'interrupted', 'completed']),
  baselinePath: z.string(),
  candidatePath: z.string(),
  baselineRevision: z.string(),
  claimToken: z.string().nullable(),
  claimOwner: z.string().nullable(),
  claimExpiresAt: z.iso.datetime().nullable(),
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
