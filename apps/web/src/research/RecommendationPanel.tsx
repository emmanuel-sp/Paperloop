import { AutoTextarea } from '../components/AutoTextarea';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
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
    queryKey: ['projects', projectId, 'recommendations', offset],
    queryFn: () => listRecommendations(projectId, offset),
  });
  return (
    <section className="recommendation-panel research-stack">
      <div>
        <p className="eyebrow">Agent proposals</p>
        <h2>Ideas to build on.</h2>
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
        <div className="empty-inline">
          <h3>No recommendations yet</h3>
          <p>
            Ask your connected agent to assess the papers in your library
            against this project’s objectives.
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
      <label>
        Decision note
        <AutoTextarea
          autoComplete="off"
          className="decision-note"
          name="decisionNote"
          rows={1}
          placeholder="Why save or dismiss this idea?"
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="form-actions">
        {(['saved', 'dismissed', 'new'] as const).map((state) => (
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
