import { useState } from 'react';
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
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['projects', projectId, 'recommendations', offset],
    queryFn: () => listRecommendations(projectId, offset),
  });
  return (
    <section className="detail-panel research-stack">
      <div>
        <p className="eyebrow">Project proposals</p>
        <h2>Recommendations</h2>
      </div>
      {query.isPending ? (
        <p role="status">Loading recommendations…</p>
      ) : query.isError ? (
        <p role="alert">{errorMessage(query.error)}</p>
      ) : query.data.length ? (
        query.data.map((item) => (
          <RecommendationCard
            key={`${item.id}:${item.updatedAt}`}
            item={item}
            onSelect={onSelect}
          />
        ))
      ) : (
        <p className="muted">
          Collected material waits for an agent to assess applicability. Saved
          and dismissed decisions survive future searches.
        </p>
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
  const client = useQueryClient();
  const triage = useMutation({
    mutationFn: (state: TriageRecommendationRequest['state']) =>
      triageRecommendation(item.projectId, item.id, { state, reason }),
    onSuccess: async () => {
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
          {item.state} · revision {item.revision} · context v
          {item.proposal.projectContextVersion}
        </small>
      </div>
      <p>{item.proposal.summary}</p>
      <div>
        <h4>Applicability</h4>
        <p>{item.proposal.applicability}</p>
      </div>
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
          Claims from research; benefits have not been measured in this project
          unless supported by an experiment.
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
      <label>
        Triage reason
        <textarea
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="form-actions">
        {(['saved', 'dismissed', 'tested', 'new'] as const).map((state) => (
          <button
            className="button"
            disabled={triage.isPending}
            key={state}
            type="button"
            onClick={() => triage.mutate(state)}
          >
            {
              {
                saved: 'Save',
                dismissed: 'Dismiss',
                tested: 'Mark tested',
                new: 'Reopen',
              }[state]
            }
          </button>
        ))}
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
