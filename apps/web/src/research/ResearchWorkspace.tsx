import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExtractionStatus,
  IngestResearchDocumentRequest,
  ResearchDocument,
  ResearchSourceKind,
} from '@paperloop/contracts';
import {
  ingestResearchDocument,
  getResearchContent,
  listResearchDocuments,
} from '../api/client';
import { AsyncState } from '../components/AsyncState';

export function ResearchWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
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
  const selected =
    documents.find((document) => document.id === selectedId) ?? documents[0];
  const contentQuery = useQuery({
    queryKey: ['projects', projectId, 'research', selected?.id, 'content'],
    queryFn: () => getResearchContent(projectId, selected?.id ?? ''),
    enabled: Boolean(selected?.extractedContentAvailable),
  });

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
    <div className="research-layout">
      <div className="research-stack">
        <PaperForm
          error={mutation.isError ? messageFromError(mutation.error) : undefined}
          isPending={mutation.isPending}
          onSubmit={(input) => mutation.mutate(input)}
        />
        <section className="detail-panel">
          <p className="eyebrow">Supplied papers</p>
          <h2>{query.data.length} in this project</h2>
          {query.data.length === 0 ? (
            <p className="muted">
              Add a paper URL, arXiv identifier, or citation to begin the experiment flow.
            </p>
          ) : (
            <div className="research-list">
              {query.data.map((document) => (
                <button
                  className={document.id === selected?.id ? 'research-item active' : 'research-item'}
                  key={document.id}
                  onClick={() => setSelectedId(document.id)}
                  type="button"
                >
                  <span>{document.title}</span>
                  <small>{document.extractionStatus} · {document.currentBrief ? `brief v${document.currentBrief.version}` : 'brief pending'}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <PaperDetail
        content={contentQuery.data?.content}
        contentIsTruncated={contentQuery.data?.nextOffset != null}
        document={selected}
      />
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
  const [extractionStatus, setExtractionStatus] =
    useState<ExtractionStatus>('pending');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      title,
      sourceKind,
      sourceReference,
      extractionStatus,
      ...(extractedContent.trim() ? { extractedContent } : {}),
      authors: [],
      submittedBy: 'user',
    });
  }

  return (
    <section className="detail-panel research-form-card">
      <p className="eyebrow">Add research</p>
      <h2>Supply a paper</h2>
      <form className="research-form" onSubmit={submit}>
        <label>Title<input onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
        <div className="form-columns">
          <label>
            Reference type
            <select onChange={(event) => setSourceKind(event.target.value as ResearchSourceKind)} value={sourceKind}>
              <option value="url">URL</option>
              <option value="arxiv">arXiv ID</option>
              <option value="reference">Citation / reference</option>
            </select>
          </label>
          <label>
            Extraction status
            <select onChange={(event) => setExtractionStatus(event.target.value as ExtractionStatus)} value={extractionStatus}>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="complete">Complete</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>
        </div>
        <label>URL or reference<input onChange={(event) => setSourceReference(event.target.value)} required value={sourceReference} /></label>
        <label>
          Extracted content
          <textarea onChange={(event) => setExtractedContent(event.target.value)} placeholder="Paste any content already available to the agent." rows={5} value={extractedContent} />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
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
  content,
  contentIsTruncated,
  document,
}: {
  content: string | undefined;
  contentIsTruncated: boolean;
  document: ResearchDocument | undefined;
}) {
  if (!document) {
    return (
      <section className="detail-panel research-detail empty-detail">
        <p className="eyebrow">Paper detail</p>
        <h2>No paper selected</h2>
        <p className="muted">Supply a paper to preserve its provenance and prepare an implementation brief.</p>
      </section>
    );
  }

  return (
    <section className="detail-panel research-detail">
      <div className="detail-title-row">
        <div><p className="eyebrow">Paper detail</p><h2>{document.title}</h2></div>
        <span className={`status-pill ${document.extractionStatus}`}>{document.extractionStatus}</span>
      </div>
      <dl className="provenance-list compact">
        <div><dt>Reference</dt><dd>{document.sourceReference}</dd></div>
        <div><dt>Version</dt><dd>{document.sourceVersion ?? 'Not specified'}</dd></div>
        <div><dt>Submitted</dt><dd>{document.submittedBy}</dd></div>
        <div><dt>Retrieved</dt><dd>{document.retrievedAt ? new Date(document.retrievedAt).toLocaleString() : 'Not recorded'}</dd></div>
      </dl>
      <div className="content-section">
        <h3>Extracted content</h3>
        <p className={content ? 'paper-content' : 'muted'}>
          {content ?? document.extractionError ?? (document.extractedContentAvailable ? 'Loading extracted content…' : 'Extraction has not produced content yet.')}
        </p>
        {contentIsTruncated ? <small className="muted">Showing the first 20,000 characters.</small> : null}
      </div>
      <div className="content-section implementation-brief">
        <p className="eyebrow">Implementation brief</p>
        {document.currentBrief ? (
          <>
            <div className="brief-heading"><h3>Version {document.currentBrief.version}</h3><small>{new Date(document.currentBrief.createdAt).toLocaleString()}</small></div>
            <p>{document.currentBrief.summary}</p>
            <h4>Why it applies</h4><p>{document.currentBrief.applicability}</p>
            <BriefList title="Proposed changes" items={document.currentBrief.proposedChanges} />
            <BriefList title="Risks" items={document.currentBrief.risks} />
            <BriefList title="Evaluation ideas" items={document.currentBrief.evaluationIdeas} />
          </>
        ) : (
          <p className="muted">Waiting for an agent to analyze this paper for the current project.</p>
        )}
      </div>
    </section>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></>;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}
