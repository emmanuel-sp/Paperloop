import { z } from 'zod';
import {
  scheduleConfigSchema,
  nativeCheckInSchema,
  claimScheduleJobSchema,
  submitScheduleJobSchema,
  automationRuleSchema,
  apiActivationSchema,
} from '@paperloop/contracts';
import type { FastifyInstance } from 'fastify';
import type { ScheduleService } from './schedule-service.js';
import type { SettingsService } from '../runtime/settings-service.js';
import type { AnalysisService } from '../analysis/analysis-service.js';
export function registerScheduleRoutes(
  app: FastifyInstance,
  schedules: ScheduleService,
  analysis: AnalysisService,
  settings: SettingsService,
) {
  const project = '/api/v1/projects/:id';
  const schedule = '/api/v1/schedules/:id';
  const job = '/api/v1/schedule-jobs/:id';
  app.get<{ Params: { id: string } }>(`${project}/schedules`, async (req) =>
    schedules.list(req.params.id),
  );
  app.post<{ Params: { id: string } }>(`${project}/schedules`, async (req) =>
    schedules.create(req.params.id, scheduleConfigSchema.parse(req.body)),
  );
  app.get<{ Params: { id: string } }>(`${schedule}/handoff`, async (req) =>
    schedules.handoff(req.params.id),
  );
  app.put<{ Params: { id: string } }>(schedule, async (req) =>
    schedules.update(req.params.id, scheduleConfigSchema.parse(req.body)),
  );
  app.post<{ Params: { id: string } }>(`${schedule}/state`, async (req) =>
    schedules.setState(
      req.params.id,
      z
        .object({ state: z.enum(['active', 'paused', 'removed']) })
        .strict()
        .parse(req.body).state,
    ),
  );
  app.post<{ Params: { id: string } }>(`${schedule}/check-in`, async (req) => {
    const value = nativeCheckInSchema.parse(req.body);
    return schedules.checkIn(
      req.params.id,
      value.revision,
      value.externalTaskReference,
      value.outcome,
      value.error,
    );
  });
  app.post<{ Params: { id: string } }>(`${schedule}/due`, async (req) =>
    schedules.due(
      req.params.id,
      z
        .object({ revision: z.number().int().positive() })
        .strict()
        .parse(req.body).revision,
    ),
  );
  app.post<{ Params: { id: string } }>(`${schedule}/scan-now`, async (req) =>
    schedules.scanNow(
      req.params.id,
      z.object({ requestId: z.uuid() }).strict().parse(req.body).requestId,
    ),
  );
  app.post<{ Params: { id: string } }>(`${job}/claim`, async (req) => {
    const value = claimScheduleJobSchema.parse(req.body);
    return schedules.claim(req.params.id, value.revision, value.owner);
  });
  app.post<{ Params: { id: string } }>(`${job}/submit`, async (req) => {
    const value = submitScheduleJobSchema.parse(req.body);
    return schedules.submit(req.params.id, value.token, value.output);
  });
  app.post<{ Params: { id: string } }>(`${job}/heartbeat`, async (req) => {
    const value = z
      .object({ token: z.uuid(), progress: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(req.body);
    return schedules.heartbeat(req.params.id, value.token, value.progress);
  });
  app.post<{ Params: { id: string } }>(`${job}/reconcile`, async (req) =>
    schedules.reconcile(
      req.params.id,
      z
        .object({ evidence: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(req.body).evidence,
    ),
  );
  app.get<{ Params: { id: string } }>(`${project}/automation`, async (req) =>
    schedules.rule(req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    `${project}/automation/approve`,
    async (req) =>
      schedules.approveRule(
        req.params.id,
        automationRuleSchema.parse(req.body),
      ),
  );
  app.post<{ Params: { id: string } }>(
    `${project}/automation/dispatch`,
    async (req) => schedules.automate(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>(
    `${project}/automation/reconcile`,
    async (req) => {
      const value = z
        .object({
          recommendationId: z.uuid(),
          evidence: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(req.body);
      return schedules.reconcileAutomation(
        req.params.id,
        value.recommendationId,
        value.evidence,
      );
    },
  );
  app.get<{ Params: { id: string } }>(`${project}/analysis`, async (req) => ({
    activations: analysis.settings(req.params.id),
  }));
  app.post<{ Params: { id: string } }>(
    `${project}/analysis/approve`,
    async (req) => {
      const activation = apiActivationSchema.parse(req.body);
      settings.requireTest(req.params.id, activation);
      return analysis.activate(req.params.id, activation);
    },
  );
}
