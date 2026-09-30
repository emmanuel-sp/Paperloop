import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  evaluationPlanListSchema,
  experimentListSchema,
  artifactContentSchema,
  experimentDetailSchema,
} from '@paperloop/contracts';
import { listResearchDocuments, request } from '../api/client';

export function ExperimentWorkspace({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState('');
  const [paperId, setPaperId] = useState('');
  const [planId, setPlanId] = useState('');
  const [copy, setCopy] = useState('');
  const [reconciliation, setReconciliation] = useState('');
  const [artifact, setArtifact] = useState<{ run: string; name: string }>();
  const papers = useQuery({
    queryKey: ['research-options', projectId],
    queryFn: () => listResearchDocuments(projectId),
  });
  const plans = useQuery({
    queryKey: ['plans', projectId],
    queryFn: async () =>
      evaluationPlanListSchema.parse(
        await request(`/api/v1/projects/${projectId}/evaluations`),
      ).plans,
  });
  const experiments = useQuery({
    queryKey: ['experiments', projectId],
    queryFn: async () =>
      experimentListSchema.parse(
        await request(`/api/v1/projects/${projectId}/experiments`),
      ).experiments,
    refetchInterval: 2000,
  });
  const id = selected || experiments.data?.[0]?.id;
  const detail = useQuery({
    queryKey: ['experiment', id],
    enabled: Boolean(id),
    queryFn: async () =>
      experimentDetailSchema.parse(await request(`/api/v1/experiments/${id}`)),
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.status === 'running') ||
      ['pending', 'claimed', 'ready'].includes(
        query.state.data?.experiment.status ?? '',
      )
        ? 1000
        : false,
  });
  const log = useQuery({
    queryKey: ['artifact', artifact?.run, artifact?.name],
    enabled: Boolean(artifact),
    queryFn: async () =>
      artifactContentSchema.parse(
        await request(
          `/api/v1/runs/${artifact?.run}/artifacts/${artifact?.name}`,
        ),
      ).content,
  });
  const mutation = useMutation({
    mutationFn: async (operation: { path: string; body: unknown }) =>
      request(operation.path, {
        method: 'POST',
        body: JSON.stringify(operation.body),
      }),
    onSuccess: async (result) => {
      if (result && typeof result === 'object' && 'experiment' in result)
        setSelected((result as { experiment: { id: string } }).experiment.id);
      await client.invalidateQueries({ queryKey: ['experiments', projectId] });
      await client.invalidateQueries({ queryKey: ['experiment'] });
    },
  });
  function create(event: FormEvent) {
    event.preventDefault();
    mutation.mutate({
      path: `/api/v1/projects/${projectId}/experiments`,
      body: {
        documentId: paperId,
        planId,
        ...(copy ? { isolatedCopy: copy } : {}),
      },
    });
  }
  const baseline = detail.data?.runs
    .filter((run) => run.role === 'baseline' && run.status === 'completed')
    .at(-1);
  const candidate = detail.data?.runs
    .filter((run) => run.role === 'candidate' && run.status === 'completed')
    .at(-1);
  const loadError = papers.error ?? plans.error ?? experiments.error;
  return (
    <div className="overview-grid experiment-layout">
      <div className="overview-stack">
        <section className="detail-panel">
          <p className="eyebrow">New experiment</p>
          <h2>Apply a supplied paper</h2>
          <form className="research-form" onSubmit={create}>
            <label>
              Paper
              <select
                required
                value={paperId}
                onChange={(e) => setPaperId(e.target.value)}
              >
                <option value="">Choose paper</option>
                {papers.data?.map((paper) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Approved evaluation plan
              <select
                required
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                <option value="">Choose plan</option>
                {plans.data
                  ?.filter((plan) => plan.approvedAt)
                  .map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.configuration.name} v{plan.version}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Prepared copy path (non-Git projects)
              <input value={copy} onChange={(e) => setCopy(e.target.value)} />
            </label>
            <button disabled={mutation.isPending} className="button primary">
              Prepare experiment
            </button>
          </form>
        </section>
        <section className="detail-panel">
          <h2>Experiments</h2>
          {experiments.data?.map((item) => (
            <button
              key={item.id}
              className="research-item"
              onClick={() => setSelected(item.id)}
            >
              {item.status} · {item.createdAt}
              <small>{item.progress}</small>
            </button>
          ))}
        </section>
      </div>
      <div className="overview-stack">
        {loadError ? (
          <p className="form-error" role="alert">
            {loadError.message}
          </p>
        ) : null}
        {mutation.error ? (
          <p className="form-error" role="alert">
            {mutation.error.message}
          </p>
        ) : null}
        {detail.error ? <p role="alert">{detail.error.message}</p> : null}
        {id && detail.isPending ? <p>Loading experiment…</p> : null}
        {detail.data ? (
          <>
            <section className="detail-panel">
              <p className="eyebrow">{detail.data.experiment.status}</p>
              <h2>{detail.data.plan.configuration.name}</h2>
              <p>{detail.data.experiment.progress}</p>
              <p>Baseline: {detail.data.experiment.baselinePath}</p>
              <p>Candidate: {detail.data.experiment.candidatePath}</p>
              <p>Source revision: {detail.data.experiment.baselineRevision}</p>
              <p>
                Context: {detail.data.experiment.contextId} · Brief:{' '}
                {detail.data.experiment.briefId ?? 'Pending'}
              </p>
              <ol>
                {detail.data.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
              {detail.data.experiment.status === 'pending' ? (
                <p className="muted">
                  Ask your connected coding agent to claim this experiment through
                  MCP and implement the paper in the candidate workspace.
                </p>
              ) : null}
              <code>{detail.data.experiment.id}</code>
              <div className="segmented-control">
                <button
                  className="button secondary"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      path: `/api/v1/experiments/${id}/runs`,
                      body: { role: 'baseline' },
                    })
                  }
                >
                  Run baseline
                </button>
                <button
                  className="button secondary"
                  disabled={
                    mutation.isPending ||
                    !['ready', 'completed'].includes(
                      detail.data.experiment.status,
                    )
                  }
                  onClick={() =>
                    mutation.mutate({
                      path: `/api/v1/experiments/${id}/runs`,
                      body: { role: 'candidate' },
                    })
                  }
                >
                  Run candidate
                </button>
                <button
                  className="button primary"
                  disabled={mutation.isPending || !baseline || !candidate}
                  onClick={() =>
                    mutation.mutate({
                      path: `/api/v1/experiments/${id}/comparisons`,
                      body: {
                        baselineRunId: baseline?.id,
                        candidateRunId: candidate?.id,
                      },
                    })
                  }
                >
                  Compare runs
                </button>
              </div>
              {detail.data.experiment.status === 'interrupted' ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    mutation.mutate({
                      path: `/api/v1/experiments/${id}/reconcile`,
                      body: { evidence: reconciliation },
                    });
                  }}
                >
                  <label>
                    Evidence that processes and workspaces were inspected
                    <textarea
                      required
                      minLength={10}
                      value={reconciliation}
                      onChange={(e) => setReconciliation(e.target.value)}
                    />
                  </label>
                  <button className="button secondary">
                    Record reconciliation
                  </button>
                </form>
              ) : null}
            </section>
            {detail.data.runs.map((run) => (
              <section className="detail-panel" key={run.id}>
                <h2>
                  {run.role} · {run.status}
                </h2>
                <p>
                  Producer: {run.producer} ({run.producerIdentity})
                </p>
                <p>Code: {run.codeIdentity}</p>
                <p>
                  Dataset: {run.datasetIdentity} · Environment:{' '}
                  {run.environmentIdentity}
                </p>
                <p>Plan fingerprint: {run.planFingerprint}</p>
                {run.error ? <p className="form-error">{run.error}</p> : null}
                {run.result?.metrics.map((metric) => (
                  <p key={metric.name}>
                    {metric.name}: {metric.value} {metric.unit}
                  </p>
                ))}
                {run.status === 'running' ? (
                  <button
                    className="button secondary"
                    onClick={() =>
                      mutation.mutate({
                        path: `/api/v1/runs/${run.id}/cancel`,
                        body: {},
                      })
                    }
                  >
                    Request cancellation
                  </button>
                ) : null}
                {run.artifactReferences.map((name) => (
                  <button
                    key={name}
                    className="button secondary"
                    onClick={() => setArtifact({ run: run.id, name })}
                  >
                    {name}
                  </button>
                ))}
              </section>
            ))}
            {detail.data.comparisons.map((comparison) => (
              <section className="detail-panel" key={comparison.id}>
                <p className="eyebrow">Comparison</p>
                <h2>{comparison.outcome.replaceAll('_', ' ')}</h2>
                {comparison.reasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Baseline</th>
                      <th>Candidate</th>
                      <th>Change</th>
                      <th>Guardrail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.metrics.map((metric) => (
                      <tr key={metric.name}>
                        <td>
                          {metric.name} ({metric.unit})
                        </td>
                        <td>{metric.baseline ?? 'Missing'}</td>
                        <td>{metric.candidate ?? 'Missing'}</td>
                        <td>
                          {metric.delta ?? 'Unknown'} (
                          {metric.percentChange?.toFixed(2) ?? 'Undefined'}%)
                        </td>
                        <td>
                          {metric.guardrail
                            ? metric.passed
                              ? 'Passed'
                              : 'Failed'
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <small>
                  Baseline run: {comparison.baselineRunId}
                  <br />
                  Candidate run: {comparison.candidateRunId}
                </small>
              </section>
            ))}
          </>
        ) : (
          <section className="detail-panel">
            <h2>Complete the experiment loop</h2>
            <p>
              Create and approve an evaluation plan, then prepare an experiment
              for a supplied paper.
            </p>
          </section>
        )}
        {artifact ? (
          <section className="detail-panel">
            <h2>{artifact.name}</h2>
            <pre className="paper-content">
              {log.data ?? log.error?.message ?? 'Loading…'}
            </pre>
          </section>
        ) : null}
      </div>
    </div>
  );
}
