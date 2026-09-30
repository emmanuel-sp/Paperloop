import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  evaluationPlanDraftSchema,
  evaluationPlanListSchema,
} from '@paperloop/contracts';
import { request } from '../api/client';

export function EvaluationWorkspace({ projectId }: { projectId: string }) {
  const client = useQueryClient();
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
  const [executable, setExecutable] = useState('python3');
  const [args, setArgs] = useState('evaluate.py');
  const [resultPath, setResultPath] = useState('result.json');
  const [environment, setEnvironment] = useState('local-default');
  const [metric, setMetric] = useState('latency');
  const [unit, setUnit] = useState('ms');
  const [direction, setDirection] = useState<'increase' | 'decrease'>(
    'decrease',
  );
  const [improvement, setImprovement] = useState('1');
  const [regression, setRegression] = useState('0');
  const [guardrails, setGuardrails] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async (operation: { path: string; body: unknown }) =>
      request(operation.path, {
        method: 'POST',
        body: JSON.stringify(operation.body),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey });
      setError('');
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const extra = guardrails.trim()
        ? (JSON.parse(guardrails) as unknown[])
        : [];
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
        failure instanceof Error ? failure.message : 'Check the plan fields.',
      );
    }
  }
  return (
    <div className="overview-grid">
      <section className="detail-panel">
        <p className="eyebrow">Evaluation plan</p>
        <h2>Define what improvement means</h2>
        <form className="research-form" onSubmit={submit}>
          <label>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Dataset identity
            <input
              required
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            />
          </label>
          <label>
            Evaluation cases — one per line
            <textarea
              required
              value={cases}
              onChange={(e) => setCases(e.target.value)}
            />
          </label>
          <div className="form-columns">
            <label>
              Metric
              <input
                required
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              />
            </label>
            <label>
              Unit
              <input
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </label>
          </div>
          <label>
            Desired direction
            <select
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
                type="number"
                min="0"
                step="any"
                value={regression}
                onChange={(e) => setRegression(e.target.value)}
              />
            </label>
          </div>
          <label>
            Additional metrics and guardrails (JSON array)
            <textarea
              value={guardrails}
              onChange={(e) => setGuardrails(e.target.value)}
              placeholder={
                '[{"name":"quality","unit":"score","direction":"increase","minimumImprovement":0,"maximumRegression":0,"guardrail":true}]'
              }
            />
          </label>
          <label>
            Executable
            <input
              required
              value={executable}
              onChange={(e) => setExecutable(e.target.value)}
            />
          </label>
          <label>
            Arguments — one per line
            <textarea value={args} onChange={(e) => setArgs(e.target.value)} />
          </label>
          <label>
            Result file in workspace
            <input
              required
              value={resultPath}
              onChange={(e) => setResultPath(e.target.value)}
            />
          </label>
          <label>
            Environment identity
            <input
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
            Save new plan version
          </button>
        </form>
      </section>
      <div className="overview-stack">
        {query.isPending ? <p>Loading plans…</p> : null}
        {query.error ? <p role="alert">{query.error.message}</p> : null}
        {query.data?.map((plan) => (
          <section key={plan.id} className="detail-panel">
            <p className="eyebrow">
              Version {plan.version} ·{' '}
              {plan.approvedAt ? 'Approved' : 'Approval required'}
            </p>
            <h2>{plan.configuration.name}</h2>
            <p>Dataset: {plan.configuration.datasetIdentity}</p>
            <p>Environment: {plan.configuration.environmentIdentity}</p>
            <p>
              Command: {plan.configuration.command.executable}{' '}
              {plan.configuration.command.arguments.join(' ')}
            </p>
            <p>
              Timeout: {plan.configuration.command.timeoutMs / 1000}s · Working
              directory: {plan.configuration.command.workingDirectory} · Result:{' '}
              {plan.configuration.command.resultPath}
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
            <p className="muted">
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
            {!plan.approvedAt ? (
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
