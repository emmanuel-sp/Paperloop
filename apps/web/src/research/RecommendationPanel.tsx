import { Field } from '../components/Field';
import { AutoTextarea } from '../components/AutoTextarea';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Recommendation,
  TriageRecommendationRequest,
} from '@paperloop/contracts';
import {
  listRecommendations,
  triageRecommendation,
  getDocument,
  errorMessage,
} from './discovery-client';

export function RecommendationPanel({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect(id: string): void;
}) {
  const [params, setParams] = useSearchParams();
  const view = params.get('decisions') === 'history' ? 'history' : 'actionable';
  const angle = params.get('angle') ?? '';
  const requestedOffset = Number(params.get('recommendationOffset') ?? 0);
  const offset =
    Number.isInteger(requestedOffset) &&
    requestedOffset >= 0 &&
    requestedOffset <= 100000
      ? requestedOffset
      : 0;
  const setOffset = (next: number) =>
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set('recommendationOffset', String(next));
      return updated;
    });
  const query = useQuery({
    queryKey: ['projects', projectId, 'recommendations', view, angle, offset],
    queryFn: () => listRecommendations(projectId, offset, view, angle),
  });
  return (
    <section className="recommendation-panel research-stack">
      <div>
        <p className="eyebrow">Agent proposals</p>
        <h2>{view === 'history' ? 'Past decisions & context' : 'Ideas to build on.'}</h2>
        <p className="muted">Current-context ideas are ordered by text overlap with your angle and project goals. Agent applicability still needs review.</p>
        <button className="button tertiary" type="button" onClick={() => setParams(previous => {
          const updated = new URLSearchParams(previous);
          if (view === 'actionable') updated.set('decisions', 'history');
          else updated.delete('decisions');
          updated.delete('recommendationOffset');
          return updated;
        })}>
          {view === 'actionable' ? 'Past decisions & context' : 'New findings'}
        </button>
      </div>
      {query.isPending ? (
        <p role="status">Loading recommendations…</p>
      ) : query.isError ? (
        <p role="alert">{errorMessage(query.error)} <button className="button" type="button" onClick={() => void query.refetch()}>Retry recommendations</button></p>
      ) : query.data.length ? (
        query.data.map((item) => (
          <RecommendationCard
            key={`${item.id}:${item.updatedAt}`}
            item={item}
            onSelect={onSelect}
          />
        ))
      ) : (
        <div className="empty-inline">
          <h3>{view === 'history' ? 'No past decisions' : 'No new recommendations'}</h3>
          <p>
            {view === 'history' ? 'Accepted, rejected, tested and older-context ideas remain here for review.' : 'Collect papers below and ask your coding agent to assess them. Accepted, rejected and tested ideas stay in past decisions.'}
          </p>
        </div>
      )}
      <div className="form-actions">
        <button
          className="button"
          disabled={!offset}
          type="button"
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous proposals
        </button>
        <button
          className="button"
          disabled={(query.data?.length ?? 0) < 20}
          type="button"
          onClick={() => setOffset(offset + 20)}
        >
          Next proposals
        </button>
      </div>
    </section>
  );
}
function RecommendationCard({
  item,
  onSelect,
}: {
  item: Recommendation;
  onSelect(id: string): void;
}) {
  const [reason, setReason] = useState(item.reason);
  const navigate = useNavigate();
  const current = item.relevance?.contextCurrent ?? true;
  const preparation = `/projects/${item.projectId}/experiments?view=prepare&paper=${item.documentId}&recommendation=${item.id}`;
  const client = useQueryClient();
  const triage = useMutation({
    mutationFn: (state: TriageRecommendationRequest['state']) =>
      triageRecommendation(item.projectId, item.id, { state, reason }),
    onSuccess: async (updated) => {
      if (updated.state === 'saved') navigate(preparation);
      await client.invalidateQueries({
        queryKey: ['projects', item.projectId, 'recommendations'],
      });
    },
  });
  return (
    <article className="recommendation-card research-stack">
      <div>
        <h3>{item.proposal.title}</h3>
        <small>
          {{ new: current ? 'New finding' : 'Needs reassessment', saved: 'Accepted', dismissed: 'Rejected', tested: 'Tested' }[item.state]} · revision {item.revision} · context v
          {item.proposal.projectContextVersion}
        </small>
      </div>
      <p>{item.proposal.summary}</p>
      <div>
        <h4>Applicability</h4>
        <p>{item.proposal.applicability}</p>
      </div>
      <div>
        <h4>Research evidence</h4>
        <p>{item.proposal.sources[0]?.claim}</p>
        <small className="muted">{item.proposal.sources[0]?.evidence}</small>
        <p className="muted">Source claims are separate from measured project results.</p>
        {item.relevance?.matchedTerms.length ? <small>Text matches: {item.relevance.matchedTerms.join(', ')}</small> : null}
        {!current ? <p role="status">Project context has changed. Ask your agent to reassess applicability before preparing an experiment.</p> : null}
      </div>
      <details>
        <summary>Evidence, prerequisites & evaluation targets</summary>
        <div>
          <h4>Prerequisites</h4>
          {item.proposal.prerequisites.length ? (
            <ul>
              {item.proposal.prerequisites.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          ) : (
            <p>None reported.</p>
          )}
        </div>
        <div>
          <h4>Uncertainty</h4>
          <p>{item.proposal.uncertainty}</p>
        </div>
        <div>
          <h4>Evaluation targets</h4>
          <ul>
            {item.proposal.evaluationTargets.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Source claims</h4>
          <p className="muted">
            Claims from research; benefits have not been measured in this
            project unless supported by an experiment.
          </p>
          {item.proposal.sources.map((source, index) => (
            <div key={`${source.documentId}:${index}`}>
              <SourceLink
                projectId={item.projectId}
                documentId={source.documentId}
                sourceVersion={source.sourceVersion}
              />
              <p>{source.claim}</p>
              <small>{source.evidence}</small>
            </div>
          ))}
        </div>
      </details>
      <details>
        <summary>Decision note (optional)</summary>
        <Field label="Decision note">
          {(attributes) => (
            <AutoTextarea
              {...attributes}
              autoComplete="off"
              className="decision-note"
              name="decisionNote"
              rows={1}
              placeholder="Why accept or reject this idea?"
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </details>
      <div className="form-actions">
        {item.state === 'new' && current ? (
          <>
            <button className="button primary" disabled={triage.isPending} type="button" onClick={() => triage.mutate('saved')}>
              {triage.isPending ? 'Saving decision…' : 'Accept & prepare'}
            </button>
            <button className="button" disabled={triage.isPending} type="button" onClick={() => triage.mutate('dismissed')}>Reject</button>
          </>
        ) : null}
        {item.experimentId ? <Link className="button" to={`/projects/${item.projectId}/experiments?experiment=${item.experimentId}`}>View experiment evidence</Link> : null}
        {item.state === 'saved' && current ? <Link className="button" to={preparation}>Continue preparation</Link> : null}
        {item.state === 'dismissed' && current ? <button className="button" disabled={triage.isPending} type="button" onClick={() => triage.mutate('new')}>Reconsider</button> : null}
        <button
          className="button"
          type="button"
          onClick={() => onSelect(item.documentId)}
        >
          Open paper
        </button>
      </div>
      {triage.isError ? <p role="alert">{errorMessage(triage.error)}</p> : null}
    </article>
  );
}
function SourceLink({
  projectId,
  documentId,
  sourceVersion,
}: {
  projectId: string;
  documentId: string;
  sourceVersion: string | null | undefined;
}) {
  const document = useQuery({
    queryKey: ['projects', projectId, 'research', documentId],
    queryFn: () => getDocument(projectId, documentId),
  });
  const url =
    document.data?.sourceKind === 'arxiv'
      ? `https://arxiv.org/abs/${document.data.sourceReference}${sourceVersion ?? ''}`
      : (document.data?.canonicalUrl ?? document.data?.sourceReference);
  if (!url || !/^https?:\/\//i.test(url))
    return <span>{document.data?.title ?? 'Source document'}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {document.data?.title ?? url}
    </a>
  );
}
