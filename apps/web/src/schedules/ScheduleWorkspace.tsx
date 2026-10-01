import { ScheduleEditor } from './ScheduleEditor';
import { ApiActivationForm } from './ApiActivationForm';
import { AutomationRuleForm } from './AutomationRuleForm';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  scheduleListSchema,
  apiActivationListSchema,
  automationStatusSchema,
  evaluationPlanListSchema,
  type Schedule,
} from '@paperloop/contracts';
import { request } from '../api/client';
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Could not complete scheduling action.';
export function ScheduleWorkspace({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const base = `/api/v1/projects/${projectId}`;
  const [instructions, setInstructions] = useState('');
  const [editing, setEditing] = useState<Schedule | null>(null);
  const state = useQuery({
    queryKey: ['projects', projectId, 'schedules'],
    queryFn: async () =>
      scheduleListSchema.parse(await request(`${base}/schedules`)),
    refetchInterval: 15000,
  });
  const providers = useQuery({
    queryKey: ['projects', projectId, 'analysis'],
    queryFn: async () =>
      apiActivationListSchema.parse(await request(`${base}/analysis`)),
  });
  const rules = useQuery({
    queryKey: ['projects', projectId, 'automation'],
    queryFn: async () =>
      automationStatusSchema.parse(await request(`${base}/automation`)),
  });
  const plans = useQuery({
    queryKey: ['projects', projectId, 'evaluations'],
    queryFn: async () =>
      evaluationPlanListSchema.parse(await request(`${base}/evaluations`)),
  });
  const action = useMutation({
    mutationFn: async (value: {
      path: string;
      body?: unknown;
      method?: string;
    }) => {
      const result = await request(value.path, {
        method: value.method ?? 'POST',
        ...(value.body ? { body: JSON.stringify(value.body) } : {}),
      });
      if (result && typeof result === 'object' && 'instructions' in result)
        setInstructions(String(result.instructions));
      return result;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
  return (
    <section className="detail-panel research-stack">
      <div>
        <p className="eyebrow">Scheduling</p>
        <h2>Research cadence and execution</h2>
        <p className="muted">
          Native tasks require an agent to install the returned handoff. Local
          API mode requires explicit activation below.
        </p>
      </div>
      {state.isError ? <p role="alert">{message(state.error)}</p> : null}
      <ScheduleEditor
        key={editing?.id ?? 'new'}
        {...(editing ? { initial: editing.config } : {})}
        editing={!!editing}
        pending={action.isPending}
        onCancel={() => setEditing(null)}
        onSave={(config) =>
          action.mutate(
            {
              path: editing
                ? `/api/v1/schedules/${editing.id}`
                : `${base}/schedules`,
              method: editing ? 'PUT' : 'POST',
              body: config,
            },
            { onSuccess: () => setEditing(null) },
          )
        }
      />
      {state.isPending ? <p role="status">Loading schedules…</p> : null}
      {state.data?.schedules.map((schedule) => (
        <article
          className="recommendation-card research-stack"
          key={schedule.id}
        >
          <h3>
            {schedule.config.cadence} · {schedule.config.timezone} ·{' '}
            {schedule.config.driver}
          </h3>
          <p>
            {schedule.state} ·{' '}
            {schedule.config.driver === 'native'
              ? schedule.setup === 'pending'
                ? 'External setup/synchronization pending'
                : schedule.setup === 'failed'
                  ? 'External setup failed'
                  : 'Agent-reported setup'
              : 'Local dispatcher'}
          </p>
          <p>
            Next: {new Date(schedule.nextAt).toLocaleString()} · Last observed
            check-in:{' '}
            {schedule.lastCheckIn
              ? new Date(schedule.lastCheckIn).toLocaleString()
              : 'None'}
          </p>
          {schedule.setupError ? (
            <p role="alert">{schedule.setupError}</p>
          ) : null}
          {schedule.externalTaskReference ? (
            <p>Task: {schedule.externalTaskReference}</p>
          ) : null}
          <div className="detail-title-row">
            <button
              className="button"
              type="button"
              disabled={action.isPending || schedule.state !== 'active'}
              onClick={() =>
                action.mutate({
                  path: `/api/v1/schedules/${schedule.id}/scan-now`,
                  body: { requestId: crypto.randomUUID() },
                })
              }
            >
              Scan now{schedule.config.driver === 'api' ? ' with paid API' : ''}
            </button>
            <button
              className="button"
              type="button"
              disabled={schedule.state === 'removed'}
              onClick={() => setEditing(schedule)}
            >
              Edit
            </button>
            <button
              className="button"
              type="button"
              disabled={action.isPending || schedule.state === 'removed'}
              onClick={() =>
                action.mutate({
                  path: `/api/v1/schedules/${schedule.id}/state`,
                  body: {
                    state: schedule.state === 'active' ? 'paused' : 'active',
                  },
                })
              }
            >
              {schedule.state === 'active' ? 'Pause' : 'Resume'}
            </button>
            <button
              className="button"
              type="button"
              disabled={action.isPending || schedule.state === 'removed'}
              onClick={() =>
                action.mutate({
                  path: `/api/v1/schedules/${schedule.id}/state`,
                  body: { state: 'removed' },
                })
              }
            >
              Remove
            </button>
            <button
              className="button"
              type="button"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  path: `/api/v1/schedules/${schedule.id}/handoff`,
                  method: 'GET',
                })
              }
            >
              {schedule.config.driver === 'native'
                ? 'Native handoff'
                : 'Dispatch details'}
            </button>
          </div>
        </article>
      ))}
      {instructions ? (
        <div className="research-stack">
          <h3>Schedule instructions</h3>
          <p>{instructions}</p>
          <button
            className="button"
            type="button"
            onClick={() => void navigator.clipboard.writeText(instructions)}
          >
            Copy instructions
          </button>
        </div>
      ) : null}
      {providers.data ? (
        <ApiActivationForm
          key={JSON.stringify(providers.data)}
          activations={providers.data.activations}
          pending={action.isPending}
          onSave={(input) =>
            action.mutate({ path: `${base}/analysis/approve`, body: input })
          }
        />
      ) : null}
      {rules.data && plans.data ? (
        <AutomationRuleForm
          key={JSON.stringify(rules.data.rule)}
          base={base}
          status={rules.data}
          plans={plans.data.plans}
          pending={action.isPending}
          onAction={(value) => action.mutate(value)}
        />
      ) : null}
      {rules.data?.reservations.map((item) => (
        <article key={item.recommendationId}>
          <p>
            Automation workspace {item.experimentId}: {item.state}
          </p>
          <p>
            Inspect the local experiments directory and record evidence before
            retrying.
          </p>
          {item.state === 'interrupted' ? (
            <Reconcile
              jobId={item.experimentId}
              pending={action.isPending}
              run={(evidence) =>
                action.mutate({
                  path: `${base}/automation/reconcile`,
                  body: { recommendationId: item.recommendationId, evidence },
                })
              }
            />
          ) : null}
        </article>
      ))}
      {providers.isError || rules.isError || plans.isError ? (
        <p role="alert">
          {message(providers.error ?? rules.error ?? plans.error)}
        </p>
      ) : null}
      <h3>Recent work</h3>
      {state.data?.jobs.map((job) => (
        <article key={job.id}>
          <strong>{job.status.replaceAll('_', ' ')}</strong>
          <p>{job.progress}</p>
          {job.error ? <p role="alert">{job.error}</p> : null}
          <small>
            {new Date(job.createdAt).toLocaleString()} · attempt {job.attempt}
          </small>
          {job.status === 'interrupted' ? (
            <Reconcile
              jobId={job.id}
              pending={action.isPending}
              run={(evidence) =>
                action.mutate({
                  path: `/api/v1/schedule-jobs/${job.id}/reconcile`,
                  body: { evidence },
                })
              }
            />
          ) : null}
        </article>
      ))}
      {action.isError ? <p role="alert">{message(action.error)}</p> : null}
    </section>
  );
}
function Reconcile({
  jobId,
  pending,
  run,
}: {
  jobId: string;
  pending: boolean;
  run: (evidence: string) => void;
}) {
  const [evidence, setEvidence] = useState('');
  return (
    <form
      className="research-form"
      onSubmit={(event) => {
        event.preventDefault();
        run(evidence);
      }}
    >
      <label htmlFor={`evidence-${jobId}`}>Reconciliation evidence</label>
      <input
        id={`evidence-${jobId}`}
        required
        maxLength={2000}
        value={evidence}
        onChange={(event) => setEvidence(event.target.value)}
      />
      <button className="button" disabled={pending}>
        Record inspection
      </button>
    </form>
  );
}
