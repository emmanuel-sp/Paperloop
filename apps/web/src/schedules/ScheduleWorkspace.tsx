import { Dialog } from '../components/Dialog';
import { AsyncState } from '../components/AsyncState';
import { SectionHeading } from '../components/SectionHeading';
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
import { WorkflowStatus, formatDate } from '../components/WorkflowStatus';
import { request } from '../api/client';
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Could not complete scheduling action.';
export function ScheduleWorkspace({
  projectId,
  view = 'schedules',
}: {
  projectId: string;
  view?: 'schedules' | 'settings';
}) {
  const client = useQueryClient();
  const base = `/api/v1/projects/${projectId}`;
  const [instructions, setInstructions] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [probePending, setProbePending] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const state = useQuery({
    queryKey: ['projects', projectId, 'schedules'],
    enabled: view === 'schedules',
    queryFn: async () =>
      scheduleListSchema.parse(await request(`${base}/schedules`)),
    refetchInterval: 15000,
  });
  const providers = useQuery({
    queryKey: ['projects', projectId, 'analysis'],
    enabled: view === 'settings',
    queryFn: async () =>
      apiActivationListSchema.parse(await request(`${base}/analysis`)),
  });
  const rules = useQuery({
    queryKey: ['projects', projectId, 'automation'],
    enabled: view === 'settings',
    queryFn: async () =>
      automationStatusSchema.parse(await request(`${base}/automation`)),
  });
  const plans = useQuery({
    queryKey: ['projects', projectId, 'evaluations'],
    enabled: view === 'settings',
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
    <div
      className={`research-stack ${view === 'settings' ? 'settings-layout' : 'schedule-layout'}`}
    >
      {view === 'settings' ? (
        <div className="settings-intro">
          <h2>Connections & execution</h2>
          <p>Connect your coding agent and review optional paid analysis.</p>
        </div>
      ) : null}
      {view === 'settings' ? (
        <SectionHeading
          title="Agent & API"
          description="Choose how analysis happens. Connections and spending stay under your control."
        />
      ) : null}
      {view === 'schedules' ? (
        <section className="detail-panel research-stack">
          <SectionHeading
            title="Research schedules"
            description="Set a cadence, then check what actually ran."
            action={
              <button
                className="button primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                New schedule
              </button>
            }
          />
          {state.isError ? (
            <AsyncState
              kind="error"
              title="Schedules could not load"
              description={message(state.error)}
              action={{
                label: 'Try again',
                onClick: () => void state.refetch(),
              }}
            />
          ) : null}
          <Dialog
            open={formOpen}
            title={editing ? 'Edit schedule' : 'New schedule'}
            description="Choose when research runs and who handles the work."
            busy={action.isPending}
            onClose={() => {
              setFormOpen(false);
              setEditing(null);
            }}
          >
            <ScheduleEditor
              key={editing?.id ?? 'new'}
              {...(editing ? { initial: editing.config } : {})}
              editing={!!editing}
              pending={action.isPending}
              onCancel={() => {
                setEditing(null);
                setFormOpen(false);
              }}
              onSave={(config) =>
                action.mutate(
                  {
                    path: editing
                      ? `/api/v1/schedules/${editing.id}`
                      : `${base}/schedules`,
                    method: editing ? 'PUT' : 'POST',
                    body: config,
                  },
                  {
                    onSuccess: () => {
                      setEditing(null);
                      setFormOpen(false);
                    },
                  },
                )
              }
            />
            {action.isError ? (
              <p role="alert">{message(action.error)}</p>
            ) : null}
          </Dialog>
          {state.data?.schedules.length === 0 ? (
            <div className="empty-inline">
              <h3>Research at your own pace</h3>
              <p>
                Create a daily or weekly schedule. Your agent installs native
                tasks; API schedules use an explicitly enabled provider.
              </p>
            </div>
          ) : null}
          {state.isPending ? (
            <AsyncState
              kind="loading"
              title="Loading schedules"
              description="Checking cadence, setup reports, and observed check-ins…"
            />
          ) : null}
          {state.data?.schedules.map((schedule) => (
            <article className="schedule-card research-stack" key={schedule.id}>
              <div className="section-heading">
                <h3>
                  {schedule.config.cadence === 'daily'
                    ? 'Daily research'
                    : 'Weekly research'}{' '}
                </h3>
                <WorkflowStatus value={schedule.state} />
              </div>
              <div className="schedule-time">
                {String(schedule.config.hour).padStart(2, '0')}:
                {String(schedule.config.minute).padStart(2, '0')}{' '}
                <small>{schedule.config.timezone}</small>
              </div>
              <p className="schedule-setup">
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
                {schedule.config.timezone} ·{' '}
                {schedule.state === 'active'
                  ? `Next: ${formatDate(schedule.nextAt)}`
                  : 'Schedule is not active'}{' '}
                · Last check-in:{' '}
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
              <div className="schedule-actions">
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
                  Scan now
                  {schedule.config.driver === 'api' ? ' with paid API' : ''}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={schedule.state === 'removed'}
                  onClick={() => {
                    setEditing(schedule);
                    setFormOpen(true);
                  }}
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
                        state:
                          schedule.state === 'active' ? 'paused' : 'active',
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
                  onClick={() => setRemoving(schedule)}
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
                onClick={() => {
                  void navigator.clipboard
                    .writeText(instructions)
                    .then(() => setCopyMessage('Copied instructions.'))
                    .catch(() =>
                      setCopyMessage(
                        'Copy unavailable. Select and copy the instructions above.',
                      ),
                    );
                }}
              >
                Copy instructions
              </button>
              <p role="status">{copyMessage}</p>
            </div>
          ) : null}
        </section>
      ) : null}
      {view === 'settings' &&
      (providers.isPending || rules.isPending || plans.isPending) ? (
        <AsyncState
          kind="loading"
          title="Loading execution settings"
          description="Checking saved activation and automation rules…"
        />
      ) : null}
      {view === 'settings' && providers.data ? (
        <section className="detail-panel">
          <SectionHeading
            eyebrow="Optional paid execution"
            title="API analysis"
            description="A saved key never activates paid work. Model keys stay in the server environment."
          />
          {providers.data.activations.some((item) => item.enabled) ? null : (
            <p className="workflow-notice">
              Paid analysis is disabled. Public-source search and local evidence
              remain available; reasoning can wait for your coding agent.
            </p>
          )}
          <button
            className="button"
            type="button"
            onClick={() => setApiOpen(true)}
          >
            Configure API analysis
          </button>
          <Dialog
            open={apiOpen}
            title="API analysis"
            description="Enable provider access deliberately. Credentials stay in the server environment."
            busy={action.isPending || probePending}
            onClose={() => setApiOpen(false)}
          >
            <ApiActivationForm
              key={JSON.stringify(providers.data)}
              projectId={projectId}
              onBusyChange={setProbePending}
              activations={providers.data.activations}
              pending={action.isPending}
              onSave={(input) =>
                action.mutate({ path: `${base}/analysis/approve`, body: input })
              }
            />
            {action.isError ? (
              <p role="alert">{message(action.error)}</p>
            ) : null}
          </Dialog>
        </section>
      ) : null}
      {view === 'settings' && rules.data && plans.data ? (
        <section className="detail-panel automation-settings">
          <SectionHeading
            title="Automation bounds"
            description="Review the limits before authorizing work to enter the queue."
          />
          <button
            className="button"
            type="button"
            onClick={() => setAutomationOpen(true)}
          >
            Review automation rules
          </button>
          <Dialog
            open={automationOpen}
            title="Automation rules"
            description="Choose what can run and the limits it must respect."
            busy={action.isPending}
            onClose={() => setAutomationOpen(false)}
          >
            <AutomationRuleForm
              key={JSON.stringify(rules.data.rule)}
              base={base}
              status={rules.data}
              plans={plans.data.plans}
              pending={action.isPending}
              onAction={(value) => action.mutate(value)}
            />
            {action.isError ? (
              <p role="alert">{message(action.error)}</p>
            ) : null}
          </Dialog>
        </section>
      ) : null}
      {view === 'settings'
        ? rules.data?.reservations.map((item) => (
            <article key={item.recommendationId}>
              <p>
                Automation workspace {item.experimentId}: {item.state}
              </p>
              <p>
                Inspect the local experiments directory and record evidence
                before retrying.
              </p>
              {item.state === 'interrupted' ? (
                <Reconcile
                  jobId={item.experimentId}
                  pending={action.isPending}
                  run={(evidence) =>
                    action.mutate({
                      path: `${base}/automation/reconcile`,
                      body: {
                        recommendationId: item.recommendationId,
                        evidence,
                      },
                    })
                  }
                />
              ) : null}
            </article>
          ))
        : null}
      {view === 'settings' &&
      (providers.isError || rules.isError || plans.isError) ? (
        <p role="alert">
          {message(providers.error ?? rules.error ?? plans.error)}
        </p>
      ) : null}
      {view === 'schedules' ? (
        <section className="detail-panel research-stack">
          <SectionHeading
            title="Recent work"
            description="Observed scans and agent activity, separate from intended timing."
          />
          {state.data?.jobs.length === 0 ? (
            <p className="muted">
              Completed scans and agent activity will appear here.
            </p>
          ) : null}
          {state.data?.jobs.map((job) => (
            <article key={job.id}>
              <WorkflowStatus value={job.status} />
              <p>{job.progress}</p>
              {job.error ? <p role="alert">{job.error}</p> : null}
              <small>
                {new Date(job.createdAt).toLocaleString()} · attempt{' '}
                {job.attempt}
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
        </section>
      ) : null}
      {action.isError && !formOpen && !apiOpen && !automationOpen ? (
        <p role="alert">{message(action.error)}</p>
      ) : null}
      <Dialog
        open={Boolean(removing)}
        title="Remove schedule"
        description="Future scans will stop. Existing research and recorded work stay in the project."
        busy={action.isPending}
        onClose={() => setRemoving(null)}
      >
        <div className="form-actions">
          <button
            className="button"
            type="button"
            onClick={() => setRemoving(null)}
          >
            Keep schedule
          </button>
          <button
            className="button primary"
            type="button"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                {
                  path: `/api/v1/schedules/${removing?.id}/state`,
                  body: { state: 'removed' },
                },
                { onSuccess: () => setRemoving(null) },
              )
            }
          >
            Remove schedule
          </button>
        </div>
        {action.isError ? <p role="alert">{message(action.error)}</p> : null}
      </Dialog>
    </div>
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
        name="evidence"
        autoComplete="off"
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
