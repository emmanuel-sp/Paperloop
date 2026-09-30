import { z } from 'zod';
import {
  evaluationPlanDraftSchema,
  evaluationResultSchema,
  experimentRequestSchema,
  evaluationPlanListSchema,
  evaluationPlanSchema,
  experimentListSchema,
  experimentDetailSchema,
  runSchema,
  comparisonSchema,
  artifactContentSchema,
} from '@paperloop/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlanService } from '../evaluations/plan-service.js';
import type { ExperimentService } from '../experiments/experiment-service.js';

export function registerWorkflowMcp(
  server: McpServer,
  plans: PlanService,
  experiments: ExperimentService,
): void {
  const project = z.object({ projectId: z.uuid() });
  const experiment = z.object({ experimentId: z.uuid() });
  const run = z.object({ runId: z.uuid() });
  const outputs: Record<string, z.ZodObject> = {
    evaluations_list: evaluationPlanListSchema,
    evaluations_draft: evaluationPlanSchema,
    evaluations_get: evaluationPlanSchema,
    implement_paper: experimentDetailSchema,
    experiments_list: experimentListSchema,
    experiments_get: experimentDetailSchema,
    experiments_claim: experimentDetailSchema,
    experiments_progress: experimentDetailSchema,
    experiments_reconcile: experimentDetailSchema,
    evaluations_run: runSchema,
    evaluations_run_get: runSchema,
    evaluations_cancel: runSchema,
    evaluations_external_result: runSchema,
    experiments_compare: comparisonSchema,
    evaluations_artifact: artifactContentSchema,
  };
  function tool<S extends z.ZodObject>(
    name: string,
    description: string,
    schema: S,
    operation: (input: z.output<S>) => unknown,
    readOnly = false,
  ) {
    const output = outputs[name];
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema.shape,
        ...(output ? { outputSchema: output.shape } : {}),
        annotations: { readOnlyHint: readOnly, destructiveHint: false },
      },
      async (input) => {
        try {
          const raw = operation(schema.parse(input));
          const value = output ? output.parse(raw) : raw;
          const structuredContent = JSON.parse(JSON.stringify(value)) as Record<
            string,
            unknown
          >;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(value) }],
            structuredContent,
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  error instanceof Error
                    ? error.message
                    : 'Workflow operation failed.',
              },
            ],
          };
        }
      },
    );
  }
  tool(
    'evaluations_list',
    'Read versioned evaluation plans and approval state.',
    project,
    ({ projectId }) => ({ plans: plans.list(projectId) }),
    true,
  );
  tool(
    'evaluations_draft',
    'Draft an immutable evaluation plan. The user approves this exact version in the workbench.',
    project.extend({ plan: evaluationPlanDraftSchema }),
    ({ projectId, plan }) => plans.draft(projectId, plan),
  );
  tool(
    'evaluations_get',
    'Inspect a plan and its approval state.',
    z.object({ planId: z.uuid() }),
    ({ planId }) => plans.get(planId),
    true,
  );
  tool(
    'implement_paper',
    'Prepare or resume an isolated experiment for a stored paper and approved plan. Inspect candidatePath and use only that workspace for implementation.',
    project.extend({ request: experimentRequestSchema }),
    ({ projectId, request }) => experiments.create(projectId, request),
  );
  tool(
    'experiments_list',
    'List durable implementation jobs for a project.',
    project,
    ({ projectId }) => ({ experiments: experiments.list(projectId) }),
    true,
  );
  tool(
    'experiments_get',
    'Inspect experiment, runs, comparisons, and required next actions.',
    experiment,
    ({ experimentId }) => experiments.detail(experimentId),
    true,
  );
  tool(
    'experiments_claim',
    'Claim one implementation job. Preserve and pass its ownership token for check-ins.',
    experiment.extend({ owner: z.string().min(1).max(200) }),
    ({ experimentId, owner }) => experiments.claim(experimentId, owner),
  );
  tool(
    'experiments_progress',
    'Report implementation progress using the current token; set ready once the candidate is prepared.',
    experiment.extend({
      token: z.string(),
      message: z.string().min(1).max(10000),
      ready: z.boolean().default(false),
    }),
    ({ experimentId, token, message, ready }) =>
      experiments.progress(experimentId, token, message, ready),
  );
  tool(
    'experiments_reconcile',
    'After inspecting workspace and process state, record evidence before retrying an interrupted attempt.',
    experiment.extend({ evidence: z.string().min(10).max(10000) }),
    ({ experimentId, evidence }) =>
      experiments.reconcile(experimentId, evidence),
  );
  tool(
    'evaluations_run',
    'Execute an already approved configuration, returning a durable run ID to poll.',
    experiment.extend({ role: z.enum(['baseline', 'candidate']) }),
    ({ experimentId, role }) => experiments.startRun(experimentId, role),
  );
  tool(
    'evaluations_run_get',
    'Poll execution state and structured evidence.',
    run,
    ({ runId }) => experiments.run(runId),
    true,
  );
  tool(
    'evaluations_cancel',
    'Request process-group cancellation; poll until cancellation is confirmed.',
    run,
    ({ runId }) => experiments.cancel(runId),
  );
  tool(
    'evaluations_external_result',
    'Store externally produced results with declared provenance; these are not independently rerun.',
    experiment.extend({
      role: z.enum(['baseline', 'candidate']),
      producerIdentity: z.string().min(1),
      codeIdentity: z.string().min(1),
      result: evaluationResultSchema,
    }),
    ({ experimentId, role, producerIdentity, codeIdentity, result }) =>
      experiments.importResult(
        experimentId,
        role,
        producerIdentity,
        codeIdentity,
        result,
      ),
  );
  tool(
    'experiments_compare',
    'Compute comparison outcomes from approved criteria and compatible run evidence.',
    experiment.extend({ baselineRunId: z.uuid(), candidateRunId: z.uuid() }),
    ({ experimentId, baselineRunId, candidateRunId }) =>
      experiments.compare(experimentId, baselineRunId, candidateRunId),
  );
  tool(
    'evaluations_artifact',
    'Read bounded logs or registered artifacts for a run.',
    run.extend({ name: z.string().min(1) }),
    ({ runId, name }) => ({ content: experiments.artifact(runId, name) }),
    true,
  );
}
