import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IngestResearchDocumentRequest,
  ResearchDocument,
  ResearchSourceKind,
} from '@paperloop/contracts';
import {
  ingestResearchDocument,
  getResearchContent,
  listResearchDocuments,
} from '../api/client';
import { DiscoveryPanel } from './DiscoveryPanel';
import { LibraryPanel } from './LibraryPanel';
import { RecommendationPanel } from './RecommendationPanel';
import { getDocument, extractDocument, errorMessage } from './discovery-client';
import { useSearchParams } from 'react-router';
import { WorkflowStatus } from '../components/WorkflowStatus';
import { AsyncState } from '../components/AsyncState';

export function ResearchWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const views = ['discovery', 'recommendations', 'library', 'supply'] as const;
  const rawView = params.get('view');
  const view = views.find((item) => item === rawView) ?? 'library';
  const selectedId = params.get('paper') ?? undefined;
  const setSelectedId = (id: string) =>
    setParams((previous) => {
      previous.set('paper', id);
      return previous;
    });
  const queryKey = ['projects', projectId, 'research'] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => listResearchDocuments(projectId),
  });
  const mutation = useMutation({
    mutationFn: (input: IngestResearchDocumentRequest) =>
      ingestResearchDocument(projectId, input),
    onSuccess: async (document) => {
      setSelectedId(document.id);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const documents = query.data ?? [];
  const selectedQuery = useQuery({
    queryKey: ['projects', projectId, 'research', selectedId],
    queryFn: () => getDocument(projectId, selectedId!),
    enabled: Boolean(selectedId),
  });
  const selected =
    selectedQuery.data ??
    documents.find((document) => document.id === selectedId);

  if (query.isPending) {
    return (
      <AsyncState
        title="Opening the research workspace"
        description="Loading supplied papers and implementation briefs…"
      />
    );
  }
  if (query.isError) {
    return (
      <AsyncState
        eyebrow="Research unavailable"
        title="We could not load this project’s research"
        description={messageFromError(query.error)}
        action={{ label: 'Try again', onClick: () => void query.refetch() }}
      />
    );
  }

  return (
    <div className="research-stack">
      <nav className="research-view-nav" aria-label="Research views">
        {views.map((value) => (
          <button
            className="button"
            aria-pressed={view === value}
            type="button"
            key={value}
            onClick={() =>
              setParams((previous) => {
                previous.set('view', value);
                return previous;
              })
            }
          >
            {
              {
                discovery: 'Discover',
                recommendations: 'Recommendations',
                library: 'Library',
                supply: 'Add a paper',
              }[value]
            }
          </button>
        ))}
      </nav>
      {selectedQuery.isError ? (
        <p role="alert">{errorMessage(selectedQuery.error)}</p>
      ) : null}
      <div className="research-layout">
        <div className="research-stack">
          {view === 'discovery' ? (
            <DiscoveryPanel projectId={projectId} />
          ) : null}
          {view === 'recommendations' ? (
            <RecommendationPanel
              projectId={projectId}
              onSelect={setSelectedId}
            />
          ) : null}
          {view === 'library' ? (
            <LibraryPanel projectId={projectId} onSelect={setSelectedId} />
          ) : null}
          {view === 'supply' ? (
            <PaperForm
              error={
                mutation.isError ? messageFromError(mutation.error) : undefined
              }
              isPending={mutation.isPending}
              onSubmit={(input) => mutation.mutate(input)}
            />
          ) : null}
        </div>
        <PaperDetail
          key={selected?.id ?? 'empty'}
          projectId={projectId}
          document={selected}
        />
      </div>
    </div>
  );
}

function PaperForm({
  error,
  isPending,
  onSubmit,
}: {
  error: string | undefined;
  isPending: boolean;
  onSubmit(input: IngestResearchDocumentRequest): void;
}) {
  const [title, setTitle] = useState('');
  const [sourceKind, setSourceKind] = useState<ResearchSourceKind>('url');
  const [sourceReference, setSourceReference] = useState('');
  const [extractedContent, setExtractedContent] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      title,
      sourceKind,
      sourceReference,
      extractionStatus: extractedContent.trim() ? 'complete' : 'pending',
      ...(extractedContent.trim() ? { extractedContent } : {}),
      authors: [],
      submittedBy: 'user',
    });
  }

  return (
    <section className="detail-panel research-form-card">
      <p className="eyebrow">Add research</p>
      <h2>Add a paper</h2>
      <form className="research-form" onSubmit={submit}>
        <label>
          Title
          <input
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        <div className="form-columns">
          <label>
            Reference type
            <select
              onChange={(event) =>
                setSourceKind(event.target.value as ResearchSourceKind)
              }
              value={sourceKind}
            >
              <option value="url">URL</option>
              <option value="arxiv">arXiv ID</option>
              <option value="reference">Citation / reference</option>
            </select>
          </label>
        </div>
        <label>
          URL or reference
          <input
            onChange={(event) => setSourceReference(event.target.value)}
            required
            value={sourceReference}
          />
        </label>
        <details>
          <summary>Add text manually (optional)</summary>
          <label>
            Paper text
            <textarea
              onChange={(event) => setExtractedContent(event.target.value)}
              placeholder="Paste the paper text if it cannot be fetched from the source."
              rows={5}
              value={extractedContent}
            />
          </label>
        </details>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button className="button primary" disabled={isPending} type="submit">
            {isPending ? 'Saving…' : 'Save paper'}
          </button>
        </div>
      </form>
    </section>
  );
}

function PaperDetail({
  projectId,
  document,
}: {
  projectId: string;
  document: ResearchDocument | undefined;
}) {
  const client = useQueryClient();
  const extraction = useMutation({
    mutationFn: () => extractDocument(projectId, document!.id),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['projects', projectId, 'research'],
      });
      await client.invalidateQueries({ queryKey: ['research-library'] });
    },
  });
  if (!document) {
    return (
      <section className="detail-panel research-detail empty-detail">
        <p className="eyebrow">Paper detail</p>
        <h2>Select a paper to read</h2>
        <p className="muted">
          Add a paper to preserve its provenance and prepare an implementation
          brief.
        </p>
      </section>
    );
  }

  return (
    <section className="detail-panel research-detail">
      <div className="detail-title-row">
        <div>
          <p className="eyebrow">Paper detail</p>
          <h2>{document.title}</h2>
        </div>
        <WorkflowStatus value={document.extractionStatus} />
      </div>
      <p className="muted">
        {document.authors.join(', ') || 'Authors not recorded'}
      </p>
      <details>
        <summary>Source & provenance</summary>
        <dl className="provenance-list compact">
          <div>
            <dt>Reference</dt>
            <dd>{document.sourceReference}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{document.sourceVersion ?? 'Not specified'}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{document.submittedBy}</dd>
          </div>
          <div>
            <dt>Retrieved</dt>
            <dd>
              {document.retrievedAt
                ? new Date(document.retrievedAt).toLocaleString()
                : 'Not recorded'}
            </dd>
          </div>
        </dl>
      </details>
      <details className="content-section">
        <summary>Full text</summary>
        <h3>Extracted content</h3>
        <button
          className="button"
          type="button"
          disabled={extraction.isPending || document.sourceKind === 'reference'}
          onClick={() => extraction.mutate()}
        >
          {extraction.isPending ? 'Extracting…' : 'Fetch full text'}
        </button>
        {extraction.isError ? (
          <p role="alert">{errorMessage(extraction.error)}</p>
        ) : null}
        {document.extractionError ? (
          <p role="status" className="muted">
            {document.extractionError}
          </p>
        ) : null}
        <ExtractedContent
          key={document.id}
          projectId={projectId}
          document={document}
        />
      </details>
      <div className="content-section implementation-brief">
        <p className="eyebrow">Implementation brief</p>
        {document.currentBrief ? (
          <>
            <div className="brief-heading">
              <h3>Version {document.currentBrief.version}</h3>
              <small>
                {new Date(document.currentBrief.createdAt).toLocaleString()}
              </small>
            </div>
            <p>{document.currentBrief.summary}</p>
            <h4>Why it applies</h4>
            <p>{document.currentBrief.applicability}</p>
            <BriefList
              title="Proposed changes"
              items={document.currentBrief.proposedChanges}
            />
            <BriefList title="Risks" items={document.currentBrief.risks} />
            <BriefList
              title="Evaluation ideas"
              items={document.currentBrief.evaluationIdeas}
            />
          </>
        ) : (
          <p className="muted">
            Connect your coding agent and ask it to analyze this paper. The
            brief will appear here when it is saved.
          </p>
        )}
      </div>
    </section>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function messageFromError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}

function ExtractedContent({
  projectId,
  document,
}: {
  projectId: string;
  document: ResearchDocument;
}) {
  const [offset, setOffset] = useState(0);
  const content = useQuery({
    queryKey: [
      'projects',
      projectId,
      'research',
      document.id,
      'content',
      offset,
    ],
    queryFn: () => getResearchContent(projectId, document.id, offset),
    enabled: document.extractedContentAvailable,
  });
  if (!document.extractedContentAvailable)
    return <p className="muted">Extraction has not produced content yet.</p>;
  if (content.isPending) return <p role="status">Loading extracted content…</p>;
  if (content.isError) return <p role="alert">{errorMessage(content.error)}</p>;
  return (
    <>
      <p className="paper-content">{content.data.content}</p>
      <small className="muted">
        Characters {offset + 1}–{offset + content.data.content.length} of{' '}
        {content.data.totalLength}
      </small>
      <div className="form-actions">
        <button
          className="button"
          type="button"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 20000))}
        >
          Previous text
        </button>
        <button
          className="button"
          type="button"
          disabled={content.data.nextOffset === null}
          onClick={() => setOffset(content.data.nextOffset ?? offset)}
        >
          Next text
        </button>
      </div>
    </>
  );
}
