import { z } from 'zod';
import {
  evaluationPlanDraftSchema,
  evaluationSuggestionSchema,
  evaluationResultSchema,
  suiteCasePageRequestSchema,
  suiteCasePageSchema,
  suiteCheckListSchema,
  experimentRequestSchema,
  implementationEvidenceSchema,
} from '@paperloop/contracts';
import type { FastifyInstance } from 'fastify';
import type { EvaluationSuggestionService } from '../evaluations/suggestion-service.js';
import type { PlanService } from '../evaluations/plan-service.js';
import type { ExperimentService } from './experiment-service.js';

export function registerWorkflowRoutes(
  app: FastifyInstance,
  plans: PlanService,
  experiments: ExperimentService,
  suggestions: EvaluationSuggestionService,
): void {
  app.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/evaluation-suggestion',
    async (request) => {
      const query = z
        .object({
          documentId: z.uuid().optional(),
          recommendationId: z.uuid().optional(),
          researchAngle: z.string().trim().max(500).optional(),
        })
        .parse(request.query);
      return evaluationSuggestionSchema.parse(
        suggestions.suggest(
          request.params.id,
          query.documentId,
          query.recommendationId,
          query.researchAngle,
        ),
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/projects/:id/evaluation-suggestion',
    async (request) => {
      const input = z
        .object({
          documentId: z.uuid().optional(),
          recommendationId: z.uuid().optional(),
          researchAngle: z.string().trim().max(500).optional(),
          contextVersion: z.number().int().positive(),
        })
        .parse(request.body);
      return suggestions.use(
        request.params.id,
        input.documentId,
        input.contextVersion,
        input.recommendationId,
        input.researchAngle,
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/evaluations',
    async (request) => ({ plans: plans.list(request.params.id) }),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/projects/:id/evaluations',
    async (request, reply) =>
      reply
        .code(201)
        .send(
          plans.draft(
            request.params.id,
            evaluationPlanDraftSchema.parse(request.body),
          ),
        ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/evaluations/:id',
    async (request) => plans.get(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/evaluations/:id/approve',
    async (request) =>
      plans.approve(
        request.params.id,
        z.object({ fingerprint: z.string() }).parse(request.body).fingerprint,
      ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/experiments',
    async (request) => ({ experiments: experiments.list(request.params.id) }),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/projects/:id/experiments',
    async (request, reply) =>
      reply
        .code(201)
        .send(
          experiments.create(
            request.params.id,
            experimentRequestSchema.parse(request.body),
          ),
        ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/experiments/:id',
    async (request) => experiments.detail(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/experiments/:id/claim',
    async (request) =>
      experiments.claim(
        request.params.id,
        z
          .object({ owner: z.string().trim().min(1).max(200) })
          .parse(request.body).owner,
      ),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/experiments/:id/progress',
    async (request) => {
      const input = z
        .object({
          token: z.string(),
          message: z.string().min(1).max(10000),
          ready: z.boolean().default(false),
          evidence: implementationEvidenceSchema.optional(),
        })
        .parse(request.body);
      return experiments.progress(
        request.params.id,
        input.token,
        input.message,
        input.ready,
        input.evidence,
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/experiments/:id/reconcile',
    async (request) =>
      experiments.reconcile(
        request.params.id,
        z
          .object({ evidence: z.string().min(10).max(10000) })
          .parse(request.body).evidence,
      ),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/experiments/:id/runs',
    async (request, reply) =>
      reply
        .code(202)
        .send(
          experiments.startRun(
            request.params.id,
            z
              .object({ role: z.enum(['baseline', 'candidate']) })
              .parse(request.body).role,
          ),
        ),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/experiments/:id/external-results',
    async (request) => {
      const input = z
        .object({
          role: z.enum(['baseline', 'candidate']),
          producerIdentity: z.string().min(1),
          codeIdentity: z.string().min(1),
          result: evaluationResultSchema,
        })
        .parse(request.body);
      return experiments.importResult(
        request.params.id,
        input.role,
        input.producerIdentity,
        input.codeIdentity,
        input.result,
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/experiments/:id/comparisons',
    async (request) => {
      const input = z
        .object({ baselineRunId: z.uuid(), candidateRunId: z.uuid() })
        .parse(request.body);
      return experiments.compare(
        request.params.id,
        input.baselineRunId,
        input.candidateRunId,
      );
    },
  );
  app.get<{ Params: { id: string } }>('/api/v1/runs/:id', async (request) =>
    experiments.run(request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/runs/:id/checks',
    async (request) =>
      suiteCheckListSchema.parse({
        checks: experiments.evidence.checks(request.params.id),
      }),
  );
  app.get<{ Params: { id: string; checkId: string } }>(
    '/api/v1/runs/:id/checks/:checkId/cases',
    async (request) => {
      const query = z
        .object({
          cursor: z.string().max(2048).optional(),
          status: suiteCasePageRequestSchema.shape.status,
          limit: z.coerce.number().int().min(1).max(100).default(100),
        })
        .strict()
        .parse(request.query);
      return suiteCasePageSchema.parse(
        experiments.evidence.cases(
          request.params.id,
          request.params.checkId,
          query,
        ),
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/runs/:id/cancel',
    async (request) => experiments.cancel(request.params.id),
  );
  app.get<{ Params: { id: string; name: string } }>(
    '/api/v1/runs/:id/artifacts/:name',
    async (request) => ({
      content: experiments.artifact(request.params.id, request.params.name),
    }),
  );
}
