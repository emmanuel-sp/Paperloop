import { isEvaluationSuite } from '@paperloop/contracts';
import { AutoTextarea } from '../components/AutoTextarea';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  evaluationPlanDraftSchema,
  evaluationPlanListSchema,
  evaluationSuggestionSchema,
} from '@paperloop/contracts';
import { Link, useSearchParams } from 'react-router';
import { request } from '../api/client';

export function EvaluationWorkspace({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const documentId = params.get('paper') ?? undefined;
  const recommendationId = params.get('recommendation') ?? undefined;
  const researchAngle = params.get('angle') ?? undefined;
  const suggestion = useQuery({
    queryKey: ['evaluation-suggestion', projectId, documentId, recommendationId, researchAngle],
    queryFn: async () => evaluationSuggestionSchema.parse(await request(`/api/v1/projects/${projectId}/evaluation-suggestion?${new URLSearchParams({ ...(documentId ? { documentId } : {}), ...(recommendationId ? { recommendationId } : {}), ...(researchAngle ? { researchAngle } : {}) })}`)),
  });
  const useSuggestion = useMutation({
    mutationFn: () => request(`/api/v1/projects/${projectId}/evaluation-suggestion`, { method: 'POST', body: JSON.stringify({ documentId, recommendationId, researchAngle, contextVersion: suggestion.data!.contextVersion }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['plans', projectId] }); await suggestion.refetch(); },
  });
  const queryKey = ['plans', projectId];
  const query = useQuery({
    queryKey,
    queryFn: async () =>
      evaluationPlanListSchema.parse(
        await request(`/api/v1/projects/${projectId}/evaluations`),
      ).plans,
  });
  const [name, setName] = useState('');
  const [dataset, setDataset] = useState('');
  const [cases, setCases] = useState('');
  const [executable, setExecutable] = useState('');
  const [args, setArgs] = useState('');
  const [resultPath, setResultPath] = useState('result.json');
  const [environment, setEnvironment] = useState('local-default');
  const [metric, setMetric] = useState('');
  const [unit, setUnit] = useState('');
  const [direction, setDirection] = useState<'increase' | 'decrease'>(
    'decrease',
  );
  const [improvement, setImprovement] = useState('1');
  const [regression, setRegression] = useState('0');
  const [guardrails, setGuardrails] = useState<
    Array<{
      name: string;
      unit: string;
      direction: 'increase' | 'decrease';
      maximumRegression: number;
    }>
  >([]);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [creating, setCreating] = useState(false);
  const mutation = useMutation({
    mutationFn: async (operation: { path: string; body: unknown }) =>
      request(operation.path, {
        method: 'POST',
        body: JSON.stringify(operation.body),
      }),
    onSuccess: async (_result, operation) => {
      await client.invalidateQueries({ queryKey });
      await client.invalidateQueries({ queryKey: ['evaluation-suggestion', projectId] });
      setError('');
      setFeedback(
        operation.path.endsWith('/approve')
          ? 'Evaluation approved. Prepare an implementation attempt with these success criteria.'
          : 'Evaluation saved. Review and approve this version below.',
      );
      if (!operation.path.endsWith('/approve')) setCreating(false);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const extra = guardrails.map((item) => ({
        ...item,
        guardrail: true,
        minimumImprovement: 0,
        minimumSamples: 1,
      }));
      const plan = evaluationPlanDraftSchema.parse({
        name,
        datasetIdentity: dataset,
        cases: cases.split('\n').filter(Boolean),
        environmentIdentity: environment,
        metrics: [
          {
            name: metric,
            unit,
            direction,
            minimumImprovement: Number(improvement),
            maximumRegression: Number(regression),
            minimumSamples: 1,
            guardrail: false,
          },
          ...extra,
        ],
        command: {
          executable,
          arguments: args.split('\n').filter(Boolean),
          workingDirectory: '.',
          resultPath,
          timeoutMs: 60000,
          environmentReferences: [],
        },
      });
      mutation.mutate({
        path: `/api/v1/projects/${projectId}/evaluations`,
        body: plan,
      });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Check the Evaluation fields.',
      );
    }
  }
  return (
    <div className="research-stack">
      {suggestion.isPending ? <p role="status">Preparing an Evaluation suggestion…</p> : null}
      {suggestion.error ? <p role="alert">{suggestion.error.message} <Link to={`/projects/${projectId}/research`}>Return to research</Link></p> : null}
      {suggestion.data ? <section className="detail-panel research-stack">
        <p className="eyebrow">Suggested Evaluation</p>
        {suggestion.data.documentTitle ? <p>For {suggestion.data.documentTitle}</p> : null}
        <h2>{suggestion.data.plan ? 'Current project Evaluation' : suggestion.data.draft?.name ?? 'Establish how success will be measured'}</h2>
        <p>Define the criteria before your coding agent implements; evaluate the candidate after it reports readiness.</p>
        <details><summary>Why this Evaluation?</summary><ul>{suggestion.data.rationale.map(reason => <li key={reason}>{reason}</li>)}</ul><p>Research angle: {suggestion.data.researchAngle}</p></details>
        {suggestion.data.limitations.map(item => <p className="muted" key={item}>{item}</p>)}
        {suggestion.data.draft ? <><p>Metrics: {isEvaluationSuite(suggestion.data.draft) ? `${suggestion.data.draft.checks.length} checks; suite execution is not available yet` : suggestion.data.draft.metrics.map(metric => `${metric.name} (${metric.unit})`).join(', ')}</p><button className="button" disabled={useSuggestion.isPending} onClick={() => useSuggestion.mutate()}>Use suggested Evaluation</button></> : null}
        {suggestion.data.plan?.approvedAt && !isEvaluationSuite(suggestion.data.plan.configuration) && documentId ? <button className="button primary" disabled={useSuggestion.isPending} onClick={() => useSuggestion.mutate(undefined, { onSuccess: () => setParams(previous => { const next = new URLSearchParams(previous); next.set('view', 'prepare'); next.set('plan', suggestion.data!.plan!.id); return next; }) })}>Continue to implementation</button> : null}
      </section> : null}
      {useSuggestion.error ? <p role="alert">{useSuggestion.error.message}</p> : null}
      <div className="form-actions">
        <button
          className="button tertiary"
          type="button"
          onClick={() => setCreating(true)}
        >
          Define custom Evaluation
        </button>
      </div>
      <Dialog
        open={creating}
        title="Define custom Evaluation"
        description="Define how a change will be measured. Review each version before approving execution."
        wide
        busy={mutation.isPending}
        onClose={() => setCreating(false)}
      >
        <p className="muted">
          Choose a metric, dataset, and command. Each version needs your
          approval before it can run.
        </p>
        <form className="research-form" onSubmit={submit}>
          <label>
            Name
            <input
              name="name"
              autoComplete="off"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Dataset identity
            <input
              name="dataset"
              autoComplete="off"
              required
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            />
          </label>
          <label>
            Evaluation cases — one per line
            <AutoTextarea
              name="cases"
              autoComplete="off"
              required
              value={cases}
              onChange={(e) => setCases(e.target.value)}
            />
          </label>
          <div className="form-columns">
            <label>
              Metric
              <input
                name="metric"
                autoComplete="off"
                required
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              />
            </label>
            <label>
              Unit
              <input
                name="unit"
                autoComplete="off"
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </label>
          </div>
          <label>
            Desired direction
            <select
              name="direction"
              autoComplete="off"
              value={direction}
              onChange={(e) => setDirection(e.target.value as typeof direction)}
            >
              <option value="decrease">Lower is better</option>
              <option value="increase">Higher is better</option>
            </select>
          </label>
          <div className="form-columns">
            <label>
              Minimum improvement
              <input
                name="improvement"
                autoComplete="off"
                type="number"
                min="0"
                step="any"
                value={improvement}
                onChange={(e) => setImprovement(e.target.value)}
              />
            </label>
            <label>
              Maximum regression
              <input
                name="regression"
                autoComplete="off"
                type="number"
                min="0"
                step="any"
                value={regression}
                onChange={(e) => setRegression(e.target.value)}
              />
            </label>
          </div>
          <details>
            <summary>Guardrail metrics</summary>
            <p className="muted">
              Set limits for metrics that must not regress.
            </p>
            {guardrails.map((item, index) => (
              <fieldset key={index}>
                <legend>Guardrail {index + 1}</legend>
                <div className="form-columns">
                  <label>
                    Metric name
                    <input
                      name="metric-name"
                      autoComplete="off"
                      required
                      value={item.name}
                      onChange={(e) =>
                        setGuardrails(
                          guardrails.map((value, i) =>
                            i === index
                              ? { ...value, name: e.target.value }
                              : value,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      name="unit"
                      autoComplete="off"
                      required
                      value={item.unit}
                      onChange={(e) =>
                        setGuardrails(
                          guardrails.map((value, i) =>
                            i === index
                              ? { ...value, unit: e.target.value }
                              : value,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="form-columns">
                  <label>
                    Direction
                    <select
                      name="direction"
                      autoComplete="off"
                      value={item.direction}
                      onChange={(e) =>
                        setGuardrails(
                          guardrails.map((value, i) =>
                            i === index
                              ? {
                                  ...value,
                                  direction: e.target.value as
                                    'increase' | 'decrease',
                                }
                              : value,
                          ),
                        )
                      }
                    >
                      <option value="increase">Higher is better</option>
                      <option value="decrease">Lower is better</option>
                    </select>
                  </label>
                  <label>
                    Maximum regression
                    <input
                      name="maximum-regression"
                      autoComplete="off"
                      required
                      type="number"
                      min="0"
                      step="any"
                      value={item.maximumRegression}
                      onChange={(e) =>
                        setGuardrails(
                          guardrails.map((value, i) =>
                            i === index
                              ? {
                                  ...value,
                                  maximumRegression: Number(e.target.value),
                                }
                              : value,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setGuardrails(guardrails.filter((_, i) => i !== index))
                  }
                >
                  Remove guardrail {index + 1}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="button"
              onClick={() =>
                setGuardrails([
                  ...guardrails,
                  {
                    name: '',
                    unit: '',
                    direction: 'increase',
                    maximumRegression: 0,
                  },
                ])
              }
            >
              Add guardrail
            </button>
          </details>
          <label>
            Executable
            <input
              name="executable"
              autoComplete="off"
              required
              value={executable}
              onChange={(e) => setExecutable(e.target.value)}
            />
          </label>
          <label>
            Arguments — one per line
            <AutoTextarea
              name="args"
              autoComplete="off"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <label>
            Result file in workspace
            <input
              name="resultPath"
              autoComplete="off"
              required
              value={resultPath}
              onChange={(e) => setResultPath(e.target.value)}
            />
          </label>
          <label>
            Environment identity
            <input
              name="environment"
              autoComplete="off"
              required
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            />
          </label>
          {error || mutation.error ? (
            <p className="form-error" role="alert">
              {error || mutation.error?.message}
            </p>
          ) : null}
          <button className="button primary" disabled={mutation.isPending}>
            Save new Evaluation version
          </button>
        </form>
      </Dialog>
      {feedback ? (
        <p role="status" className="workflow-notice">
          {feedback}
        </p>
      ) : null}
      {mutation.error ? <p role="alert">{mutation.error.message}</p> : null}
      <div className="overview-stack">
        {query.isPending ? <p>Loading Evaluation…</p> : null}
        {query.error ? <p role="alert">{query.error.message}</p> : null}
        {query.data?.length === 0 ? (
          <section className="detail-panel empty-inline">
            <h2>No saved Evaluation yet</h2>
            <p>
              Use a suggestion or ask your coding agent to supply a measurement contract. You
              review the command and approve each version here.
            </p>
          </section>
        ) : null}
        {query.data?.map((plan) => (
          <section key={plan.id} className="detail-panel">
            <p className="eyebrow">
              Version {plan.version} ·{' '}
              {plan.approvedAt ? 'Approved' : 'Approval required'}
            </p>
            <h2>{plan.configuration.name}</h2>
            {isEvaluationSuite(plan.configuration) ? <>
              <p>{plan.configuration.checks.length} checks · overall limit {plan.configuration.overallTimeoutMs / 1000}s</p>
              <p className="workflow-notice">Layered Evaluation execution is not available yet. You can inspect this saved suite.</p>
              <ul>{plan.configuration.checks.map(check => <li key={check.id}>{check.name} · {check.required ? 'required' : 'optional'} · {check.report.adapter}</li>)}</ul>
            </> : <>
            <p>Measures {plan.configuration.metrics.map(metric => `${metric.name} in ${metric.unit}${metric.guardrail ? ' (guardrail)' : ''}`).join('; ')}.</p>
            <dl className="provenance-list">
              <div>
                <dt>Dataset</dt>
                <dd>{plan.configuration.datasetIdentity}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{plan.configuration.environmentIdentity}</dd>
              </div>
            </dl>
            <p>
              <strong>Command</strong>{' '}
              <code>
                {plan.configuration.command.executable}{' '}
                {plan.configuration.command.arguments.join(' ')}
              </code>
            </p>
            <details>
              <summary>Cases & metric thresholds</summary>
              <p>Dataset: {plan.configuration.datasetIdentity}</p>
              <p>Environment: {plan.configuration.environmentIdentity}</p>
              <p>
                Command: {plan.configuration.command.executable}{' '}
                {plan.configuration.command.arguments.join(' ')}
              </p>
              <p>
                Timeout: {plan.configuration.command.timeoutMs / 1000}s ·
                Working directory: {plan.configuration.command.workingDirectory}{' '}
                · Result: {plan.configuration.command.resultPath}
              </p>
              <p>
                Environment references:{' '}
                {plan.configuration.command.environmentReferences.join(', ') ||
                  'None'}
              </p>
              <ul>
                {plan.configuration.cases.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <ul>
                {plan.configuration.metrics.map((item) => (
                  <li key={item.name}>
                    {item.name}: {item.direction}, improvement ≥{' '}
                    {item.minimumImprovement} {item.unit}, regression ≤{' '}
                    {item.maximumRegression} {item.unit}, samples ≥{' '}
                    {item.minimumSamples}
                    {item.guardrail ? ' (guardrail)' : ''}
                  </li>
                ))}
              </ul>
            </details>
            </>}
            <p className="workflow-notice">
              Evaluations run with your local permissions. Review the command
              and inputs before approving this version.
            </p>
            <details>
              <summary>Exact configuration and fingerprint</summary>
              <pre className="paper-content">
                {JSON.stringify(plan.configuration, null, 2)}
              </pre>
              <code>{plan.fingerprint}</code>
            </details>
            {!plan.approvedAt && !isEvaluationSuite(plan.configuration) ? (
              <button
                className="button primary"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    path: `/api/v1/evaluations/${plan.id}/approve`,
                    body: { fingerprint: plan.fingerprint },
                  })
                }
              >
                Approve version {plan.version}
              </button>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
