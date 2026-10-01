import { z } from 'zod';
import { storeRecommendationRequestSchema } from './discovery.js';
import {
  evaluationPlanDraftSchema,
  experimentRequestSchema,
} from './evaluations.js';
const text = z.string().trim().min(1).max(2000);
export const scheduleConfigSchema = z
  .object({
    cadence: z.enum(['daily', 'weekly']).default('daily'),
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Use an IANA timezone.'),
    hour: z.number().int().min(0).max(23).default(9),
    minute: z.number().int().min(0).max(59).default(0),
    weekday: z.number().int().min(0).max(6).default(1),
    driver: z.enum(['native', 'api']).default('native'),
    mechanism: z
      .enum(['codex-desktop', 'claude-desktop', 'claude-session'])
      .default('codex-desktop'),
    query: z.string().trim().max(500).default(''),
    provider: z.enum(['openai', 'anthropic']).default('openai'),
  })
  .strict();
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;
export const scheduleSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  revision: z.number().int().positive(),
  config: scheduleConfigSchema,
  state: z.enum(['active', 'paused', 'removed']),
  nextAt: z.iso.datetime(),
  setup: z.enum(['pending', 'reported', 'failed']),
  setupError: z.string().max(2000).nullable().default(null),
  externalTaskReference: text.nullable(),
  lastCheckIn: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Schedule = z.infer<typeof scheduleSchema>;
export const scheduleJobSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  scheduleId: z.uuid(),
  revision: z.number().int().positive(),
  occurrence: z.string(),
  status: z.enum([
    'pending',
    'waiting_for_agent',
    'claimed',
    'running',
    'completed',
    'failed',
    'interrupted',
    'cancelled',
  ]),
  attempt: z.number().int().nonnegative(),
  token: z.uuid().nullable(),
  owner: text.nullable(),
  expiresAt: z.iso.datetime().nullable(),
  retryAt: z.iso.datetime().nullable(),
  scanId: z.uuid().nullable(),
  documentIds: z.array(z.uuid()),
  error: z.string().nullable(),
  progress: z.string().max(2000),
  createdAt: z.iso.datetime(),
});
export type ScheduleJob = z.infer<typeof scheduleJobSchema>;
export const scheduleListSchema = z.object({
  schedules: z.array(scheduleSchema),
  jobs: z.array(scheduleJobSchema),
});
export const nativeCheckInSchema = z
  .object({
    revision: z.number().int().positive(),
    externalTaskReference: text.optional(),
    outcome: z.enum(['configured', 'failed']).default('configured'),
    error: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (value) => value.outcome !== 'failed' || !!value.error,
    'Describe the failed native handoff.',
  );
export const claimScheduleJobSchema = z
  .object({ revision: z.number().int().positive(), owner: text })
  .strict();
export const analysisOutputSchema = z
  .object({
    recommendations: z.array(storeRecommendationRequestSchema).max(25),
    plans: z.array(evaluationPlanDraftSchema).max(5),
  })
  .strict();
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export const submitScheduleJobSchema = z
  .object({ token: z.uuid(), output: analysisOutputSchema })
  .strict();
export const automationRuleSchema = z
  .object({
    enabled: z.boolean(),
    goals: z.array(text).min(1).max(20),
    categories: z.array(text).min(1).max(20),
    planId: z.uuid(),
    maxExperiments: z.number().int().min(1).max(100),
    maxRuns: z.number().int().min(1).max(100),
  })
  .strict();
export type AutomationRule = z.infer<typeof automationRuleSchema>;
export const automatedExperimentSchema = z
  .object({
    recommendationId: z.uuid(),
    goal: text,
    category: text,
    experiment: experimentRequestSchema,
  })
  .strict();
export const apiActivationSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().trim().min(1).max(200),
  })
  .strict();
export type ApiActivation = z.infer<typeof apiActivationSchema>;
export const manualAnalysisSchema = z
  .object({
    provider: z.enum(['openai', 'anthropic']),
    documentIds: z.array(z.uuid()).min(1).max(25),
  })
  .strict();

export const apiActivationListSchema = z.object({
  activations: z.array(apiActivationSchema),
});
export const automationStatusSchema = z.object({
  rule: automationRuleSchema.nullable(),
  approvedAt: z.string().nullable(),
  usedExperiments: z.number().int().nonnegative(),
  reservations: z.array(
    z.object({
      projectId: z.uuid(),
      recommendationId: z.uuid(),
      experimentId: z.uuid(),
      maxRuns: z.number(),
      attempts: z.number(),
      state: z.enum(['creating', 'interrupted', 'completed', 'reconciled']),
      evidence: z.string(),
    }),
  ),
});
