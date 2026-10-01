import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  scheduleConfigSchema,
  nativeCheckInSchema,
  claimScheduleJobSchema,
  submitScheduleJobSchema,
  automatedExperimentSchema,
} from '@paperloop/contracts';
import type { ScheduleService } from '../schedules/schedule-service.js';
const project = z.object({ projectId: z.uuid() });
const schedule = z.object({ scheduleId: z.uuid() });
const job = z.object({ jobId: z.uuid() });
async function result(operation: () => unknown | Promise<unknown>) {
  try {
    const value = await operation();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value) }],
      structuredContent: value as Record<string, unknown>,
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
              : 'Scheduling operation failed.',
        },
      ],
    };
  }
}
export function registerScheduleMcp(
  server: McpServer,
  schedules: ScheduleService,
) {
  server.registerTool(
    'schedules_list',
    {
      description:
        'Inspect durable schedules and latest 100 jobs. Connection does not wake an agent.',
      inputSchema: project,
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => result(() => schedules.list(projectId)),
  );
  server.registerTool(
    'schedules_create',
    {
      description:
        'Configure intended cadence. Native setup remains pending until reported. API mode requires prior workbench activation.',
      inputSchema: project.extend({ config: scheduleConfigSchema }),
    },
    async ({ projectId, config }) =>
      result(() => schedules.create(projectId, config)),
  );
  server.registerTool(
    'schedules_update',
    {
      description:
        'Update cadence and invalidate old callback revisions. Returns a new native handoff.',
      inputSchema: schedule.extend({ config: scheduleConfigSchema }),
    },
    async ({ scheduleId, config }) =>
      result(() => schedules.update(scheduleId, config)),
  );
  server.registerTool(
    'schedules_state',
    {
      description:
        'Pause, resume, or remove intended scheduling; inspect external synchronization handoff.',
      inputSchema: schedule.extend({
        state: z.enum(['active', 'paused', 'removed']),
      }),
    },
    async ({ scheduleId, state }) =>
      result(() => schedules.setState(scheduleId, state)),
  );
  server.registerTool(
    'schedules_handoff',
    {
      description:
        'Read native task instructions. Generating instructions does not install an external schedule.',
      inputSchema: schedule,
      annotations: { readOnlyHint: true },
    },
    async ({ scheduleId }) => result(() => schedules.handoff(scheduleId)),
  );
  server.registerTool(
    'schedules_check_in',
    {
      description:
        'Report native setup/update/pause/removal result with task reference. This is reported setup, not observed execution.',
      inputSchema: schedule.extend({ report: nativeCheckInSchema }),
    },
    async ({ scheduleId, report }) =>
      result(() =>
        schedules.checkIn(
          scheduleId,
          report.revision,
          report.externalTaskReference,
          report.outcome,
          report.error,
        ),
      ),
  );
  server.registerTool(
    'schedules_due',
    {
      description:
        'Record an actual native check-in and acquire due occurrences. Old and paused callbacks reject work.',
      inputSchema: schedule.extend({ revision: z.number().int().positive() }),
    },
    async ({ scheduleId, revision }) =>
      result(() => schedules.due(scheduleId, revision)),
  );
  server.registerTool(
    'schedules_scan_now',
    {
      description:
        'Queue one explicit manual occurrence with idempotency requestId. The configured driver is used; API mode may incur cost only after workbench activation.',
      inputSchema: schedule.extend({ requestId: z.uuid() }),
    },
    async ({ scheduleId, requestId }) =>
      result(() => schedules.scanNow(scheduleId, requestId)),
  );
  server.registerTool(
    'schedules_claim',
    {
      description:
        'Claim waiting native analysis, collect bounded research, and retrieve project context. Use returned token and heartbeat every five minutes.',
      inputSchema: job.extend({ claim: claimScheduleJobSchema }),
    },
    async ({ jobId, claim }) =>
      result(() => schedules.claim(jobId, claim.revision, claim.owner)),
  );
  server.registerTool(
    'schedules_submit',
    {
      description:
        'Atomically validate and save assigned research recommendations and evaluation drafts. Does not approve or implement.',
      inputSchema: job.extend({ submission: submitScheduleJobSchema }),
    },
    async ({ jobId, submission }) =>
      result(() =>
        schedules.submit(jobId, submission.token, submission.output),
      ),
  );
  server.registerTool(
    'schedules_heartbeat',
    {
      description: 'Renew the current native claim and record progress.',
      inputSchema: job.extend({
        token: z.uuid(),
        progress: z.string().trim().min(1).max(2000),
      }),
    },
    async ({ jobId, token, progress }) =>
      result(() => schedules.heartbeat(jobId, token, progress)),
  );
  server.registerTool(
    'schedules_reconcile',
    {
      description:
        'Record inspection evidence for stopped interrupted analysis before a distinct bounded attempt. Never silently switch provider.',
      inputSchema: job.extend({ evidence: z.string().trim().min(1).max(2000) }),
    },
    async ({ jobId, evidence }) =>
      result(() => schedules.reconcile(jobId, evidence)),
  );
  server.registerTool(
    'schedules_automation',
    {
      description:
        'Inspect user-approved goals/categories, exact evaluation prerequisites, and remaining experiment budget.',
      inputSchema: project,
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => result(() => schedules.rule(projectId)),
  );
  server.registerTool(
    'schedules_automate',
    {
      description:
        'Queue an eligible isolated experiment under an existing workbench-approved rule. One unfinished experiment per project. Wait for a coding agent; never merge.',
      inputSchema: project.extend({ request: automatedExperimentSchema }),
    },
    async ({ projectId, request }) =>
      result(() => schedules.automate(projectId, request)),
  );
}
