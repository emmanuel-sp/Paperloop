import { isEvaluationSuite } from '@paperloop/contracts';
import { Link } from 'react-router';
import { useState } from 'react';
import type { ExperimentDetail, ResearchDocument } from '@paperloop/contracts';
import { formatDate } from '../components/WorkflowStatus';
export function ExperimentLifecycle({
  detail,
  paper,
}: {
  detail: ExperimentDetail;
  paper: ResearchDocument | undefined;
}) {
  const [copyMessage, setCopyMessage] = useState('');
  const { experiment, plan, runs, comparisons } = detail;
  const baseline = runs.filter((run) => run.role === 'baseline').at(-1);
  const candidate = runs.filter((run) => run.role === 'candidate').at(-1);
  const implemented = ['ready', 'completed'].includes(experiment.status);
  const stages = [
    { name: 'Prepare', state: 'Done' },
    { name: 'Measure baseline', state: baseline?.status ?? 'Next' },
    {
      name: 'Implement',
      state: implemented
        ? 'Agent reported ready'
        : experiment.status === 'claimed'
          ? 'Agent working'
          : experiment.status === 'interrupted'
            ? 'Interrupted'
            : 'Waiting for your agent',
    },
    {
      name: 'Evaluate candidate',
      state:
        candidate?.status ??
        (implemented ? 'Ready to run' : 'Waiting for implementation'),
    },
    {
      name: 'Review',
      state: comparisons.length
        ? 'Evidence available'
        : 'Waiting for measurements',
    },
  ];
  const task = `Implement research in Paperloop experiment ${experiment.id} for project ${experiment.projectId}.
Paper: ${paper?.title ?? experiment.documentId}; source version: ${experiment.sourceVersion ?? 'unversioned'}.
Research angle: ${experiment.researchAngle || 'Review the project objectives'}.
Pinned project context: ${experiment.contextId}; pinned brief: ${experiment.briefId ?? 'Not supplied; store an implementation brief before changing code'}.
Read experiments_get and the paper with research_get_document / research_read_content. If source/context/brief has changed, stop and reassess before implementation.
${paper?.currentBrief?.id === experiment.briefId ? `Brief summary: ${paper.currentBrief.summary}` : ''}
Approved Evaluation: ${plan.configuration.name}, version ${plan.version}, fingerprint ${plan.fingerprint}.
Baseline workspace (preserve): ${experiment.baselinePath}
Candidate workspace (edit only here): ${experiment.candidatePath}
Run the approved baseline before implementing. Claim with experiments_claim only if pending; retain your returned ownership token and check experiments_get if another agent owns the work. Report actual progress with experiments_progress before the five-minute claim expires.
Do not approve commands, activate paid APIs, modify the original/baseline checkout, or merge. Inspect and reconcile interrupted work before retrying.
When ready, call experiments_progress with your current token, ready:true, and evidence:{summary,changedFiles,checks,limitations}. Report only changes and checks you actually made; readiness is agent-reported, not a measurement.
Then evaluate the candidate with the approved configuration and review compatible baseline/candidate evidence. Never claim success from a paper or a spinner.`;
  return (
    <section className="detail-panel research-stack experiment-lifecycle">
      <p className="eyebrow">Research → implementation → evidence</p>
      <h2>{paper?.title ?? 'Implementation attempt'}</h2>
      <ol className="experiment-stages" aria-label="Experiment lifecycle">
        {stages.map((stage) => (
          <li key={stage.name}>
            <strong>{stage.name}</strong>
            <span>{stage.state}</span>
          </li>
        ))}
      </ol>
      <p>
        {experiment.status === 'pending'
          ? 'Your coding agent implements the research in the isolated candidate. Paperloop coordinates the handoff and measures the outcome.'
          : implemented
            ? 'Your agent has marked this implementation ready. Evaluate the candidate with the approved configuration, then compare it with the baseline.'
            : experiment.status === 'interrupted'
              ? 'Agent activity is no longer current. Inspect the processes and workspaces, then reconcile this attempt before continuing.'
              : 'Implementation is owned by your coding agent. Progress below reflects its latest report.'}
      </p>
      <dl className="provenance-list">
        <div>
          <dt>Agent</dt>
          <dd>
            {experiment.claimOwner ?? 'No agent has claimed this attempt'}
          </dd>
        </div>
        <div>
          <dt>Last check-in</dt>
          <dd>
            {experiment.lastAgentCheckIn
              ? formatDate(experiment.lastAgentCheckIn)
              : 'No observed check-in'}
          </dd>
        </div>
      </dl>
      <p role="status">{experiment.progress}</p>
      <details>
        <summary>Implementation handoff</summary>
        <p>
          Configure the coding agent in Settings, then give it this task.
          Copying does not launch work.
        </p>
        <Link to={`/projects/${experiment.projectId}/settings?tab=agent`}>Configure coding agent</Link>
        <pre className="paper-content">{task}</pre>
        <button
          className="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(task);
              setCopyMessage('Implementation handoff copied.');
            } catch {
              setCopyMessage(
                'Clipboard unavailable. Select and copy the handoff above.',
              );
            }
          }}
        >
          Copy implementation handoff
        </button>
        {copyMessage ? <p role="status">{copyMessage}</p> : null}
      </details>
      {experiment.implementationSummary ? (
        <section>
          <h3>Agent-reported implementation</h3>
          <p>{experiment.implementationSummary.summary}</p>
          <p>Candidate to evaluate: {experiment.candidatePath}</p>
          <details>
            <summary>Reported changes, checks & limitations</summary>
            <ul>
              {experiment.implementationSummary.changedFiles.map((file) => (
                <li key={file}>Changed: {file}</li>
              ))}
              {experiment.implementationSummary.checks.map((check) => (
                <li key={check}>Check: {check}</li>
              ))}
              {experiment.implementationSummary.limitations.map((item) => (
                <li key={item}>Limitation: {item}</li>
              ))}
            </ul>
            {!experiment.implementationSummary.changedFiles.length ||
            !experiment.implementationSummary.checks.length ? (
              <p className="muted">
                The agent has not supplied a complete change/check record.
                Readiness does not establish a successful Evaluation.
              </p>
            ) : null}
          </details>
        </section>
      ) : implemented ? (
        <p className="muted">
          This older attempt has no structured implementation summary.
        </p>
      ) : null}
      <details>
        <summary>What will Evaluation measure?</summary>
        <p>
          {plan.configuration.name} · approved version {plan.version}
        </p>
        <p>Dataset: {plan.configuration.datasetIdentity}</p>
        <ul>
          {(isEvaluationSuite(plan.configuration) ? plan.configuration.checks.flatMap(check => check.metrics) : plan.configuration.metrics).map((metric) => (
            <li key={metric.name}>
              {metric.name} · {metric.unit} ·{' '}
              {metric.guardrail ? 'regression guardrail' : 'primary metric'} ·
              at least {metric.minimumSamples} sample(s)
            </li>
          ))}
        </ul>
        <p className="muted">
          Results identify the exact candidate code and Evaluation fingerprint;
          an agent’s implementation report is separate evidence.
        </p>
      </details>
    </section>
  );
}
