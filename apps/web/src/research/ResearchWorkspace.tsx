import { AutoTextarea } from '../components/AutoTextarea';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ResearchImportCommit,
  ResearchImportPreview,
  ResearchDocument,
} from '@paperloop/contracts';
import {
  request,
  getResearchContent,
  listResearchDocuments,
} from '../api/client';
import {
  researchImportPreviewSchema,
  researchDocumentSchema,
} from '@paperloop/contracts';
import { Dialog } from '../components/Dialog';
import { Field } from '../components/Field';
import { SourceWorkspace } from './SourceWorkspace';
import { DiscoveryPanel } from './DiscoveryPanel';
import { LibraryPanel } from './LibraryPanel';
import { RecommendationPanel } from './RecommendationPanel';
import { getDocument, extractDocument, errorMessage } from './discovery-client';
import { Link, useSearchParams } from 'react-router';
import { WorkflowStatus } from '../components/WorkflowStatus';
import { AsyncState } from '../components/AsyncState';

export function ResearchWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rawView = params.get('view');
  const openSecondary = (next: 'sources' | 'supply' | 'library') =>
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set('view', next);
      return updated;
    });
  const closeSecondary = () =>
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.delete('view');
      return updated;
    });
  const selectedId = params.get('paper') ?? undefined;
  const setSelectedId = (id: string) =>
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set('paper', id);
      updated.delete('view');
      return updated;
    });
  const queryKey = ['projects', projectId, 'research'] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => listResearchDocuments(projectId),
  });
  const mutation = useMutation({
    mutationFn: async (input: ResearchImportCommit) =>
      researchDocumentSchema.parse(
        await request(`/api/v1/projects/${projectId}/research/import/commit`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: async (document) => {
      setParams((previous) => {
        const updated = new URLSearchParams(previous);
        updated.set('paper', document.id);
        updated.delete('view');
        return updated;
      });
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
        kind="loading"
        title="Opening the research workspace"
        description="Loading supplied papers and implementation briefs…"
      />
    );
  }
  if (query.isError) {
    return (
      <AsyncState
        kind="error"
        eyebrow="Research unavailable"
        title="We could not load this project’s research"
        description={messageFromError(query.error)}
        action={{ label: 'Try again', onClick: () => void query.refetch() }}
      />
    );
  }

  return (
    <div className="research-stack">
      <div className="research-toolbar">
        <div className="form-actions">
          <button
            type="button"
            className="button tertiary"
            onClick={() => openSecondary('library')}
          >
            Saved research
          </button>
          <button
            type="button"
            className="button tertiary"
            onClick={() => openSecondary('sources')}
          >
            Sources
          </button>
          <button
            type="button"
            className="button tertiary"
            onClick={() => openSecondary('supply')}
          >
            Import paper
          </button>
        </div>
      </div>
      {selectedQuery.isError ? (
        <p role="alert">{errorMessage(selectedQuery.error)}</p>
      ) : null}
      <div
        className={`research-layout ${selectedId ? '' : 'research-unselected'}`}
      >
        <div className="research-stack">
          <RecommendationPanel projectId={projectId} onSelect={setSelectedId} />
          <DiscoveryPanel
            projectId={projectId}
            documents={documents}
            onSelect={setSelectedId}
          />
        </div>
        {selectedId ? (
          <PaperDetail
            key={selected?.id ?? 'empty'}
            projectId={projectId}
            document={selected}
          />
        ) : null}
      </div>
      <Dialog
        open={rawView === 'library'}
        title="Saved research"
        description="Find collected papers or reuse material from another project."
        onClose={closeSecondary}
      >
        {rawView === 'library' ? (
          <LibraryPanel projectId={projectId} onSelect={setSelectedId} />
        ) : null}
      </Dialog>
      <Dialog
        open={rawView === 'sources'}
        title="Research sources"
        description="Choose where this project discovers research."
        onClose={closeSecondary}
      >
        <SourceWorkspace projectId={projectId} />
      </Dialog>
      <Dialog
        open={rawView === 'supply'}
        title="Import paper"
        description="Bring a known paper into this project’s research."
        busy={mutation.isPending}
        onClose={closeSecondary}
      >
        <PaperForm
          key={`${projectId}-${rawView}`}
          projectId={projectId}
          error={
            mutation.isError ? messageFromError(mutation.error) : undefined
          }
          isPending={mutation.isPending}
          onSubmit={(input) => mutation.mutate(input)}
        />
      </Dialog>
    </div>
  );
}

function PaperForm({
  projectId,
  error,
  isPending,
  onSubmit,
}: {
  projectId: string;
  error: string | undefined;
  isPending: boolean;
  onSubmit(input: ResearchImportCommit): void;
}) {
  const [input, setInput] = useState('');
  const [file, setFile] = useState<{
    name: string;
    contentType: string;
    data: string;
  }>();
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState<ResearchImportPreview>();
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [content, setContent] = useState('');
  const lookup = useMutation({
    mutationFn: async () =>
      researchImportPreviewSchema.parse(
        await request(`/api/v1/projects/${projectId}/research/import/preview`, {
          method: 'POST',
          body: JSON.stringify({ input, file }),
        }),
      ),
    onSuccess: (result) => {
      setPreview(result);
      setTitle(result.document.title);
      setAuthors(result.document.authors.join('\n'));
    },
  });
  const busy = lookup.isPending || isPending;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) lookup.mutate();
    else
      onSubmit({
        previewId: preview.id,
        title,
        authors: authors
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        ...(content.trim() ? { extractedContent: content } : {}),
      });
  }
  return (
    <form className="research-form" onSubmit={submit}>
      {!preview ? (
        <>
          <Field
            label="Paper reference or text"
            hint="Paste a URL, arXiv ID, DOI, citation, or paper text."
          >
            {(attributes) => (
              <AutoTextarea
                {...attributes}
                rows={4}
                value={input}
                disabled={busy || Boolean(file)}
                onChange={(event) => setInput(event.target.value)}
                required={!file}
              />
            )}
          </Field>
          <Field
            label="Or upload a file"
            hint="PDF or plain text, up to 1 MiB."
          >
            {(attributes) => (
              <input
                {...attributes}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                disabled={busy}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  setFile(undefined);
                  setFileError('');
                  if (!selected) return;
                  if (selected.size > 1024 * 1024 || !selected.size) {
                    setFileError('Choose a nonempty file up to 1 MiB.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    setInput('');
                    setFile({
                      name: selected.name,
                      contentType: selected.type,
                      data: String(reader.result).split(',')[1]!,
                    });
                  };
                  reader.onerror = () =>
                    setFileError('The file could not be read.');
                  reader.readAsDataURL(selected);
                }}
              />
            )}
          </Field>
        </>
      ) : (
        <section className="research-stack import-preview">
          <p className="eyebrow">Import preview · {preview.inputKind}</p>
          <h3>{preview.document.title}</h3>
          <p className="muted">
            {preview.document.authors.join(', ') || 'Authors not identified'}
          </p>
          <p>
            {preview.document.sourceReference}
            {preview.document.sourceVersion
              ? ` · ${preview.document.sourceVersion}`
              : ''}
          </p>
          <WorkflowStatus value={preview.document.extractionStatus} />
          {preview.document.extractedContent ? (
            <p>
              {preview.document.extractedContent.slice(0, 500)}
              {preview.document.extractedContent.length > 500 ? '…' : ''}
            </p>
          ) : null}
          {preview.duplicateId ? (
            <p role="status">
              This paper is already in the library. Saving reuses its existing
              record.
            </p>
          ) : null}
          <ul>
            {preview.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {preview.document.extractionError ? (
            <p role="status">{preview.document.extractionError}</p>
          ) : null}
          <details>
            <summary>Correct metadata or add text</summary>
            <Field label="Title">
              {(attributes) => (
                <input
                  {...attributes}
                  value={title}
                  required
                  maxLength={500}
                  onChange={(event) => setTitle(event.target.value)}
                />
              )}
            </Field>
            <Field label="Authors" hint="One author per line.">
              {(attributes) => (
                <AutoTextarea
                  {...attributes}
                  rows={2}
                  value={authors}
                  onChange={(event) => setAuthors(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Paper text"
              hint="Optional fallback when source text is unavailable."
            >
              {(attributes) => (
                <AutoTextarea
                  {...attributes}
                  rows={4}
                  value={content}
                  maxLength={500_000}
                  onChange={(event) => setContent(event.target.value)}
                />
              )}
            </Field>
          </details>
          <button
            type="button"
            className="button tertiary"
            disabled={busy}
            onClick={() => {
              setPreview(undefined);
              setContent('');
            }}
          >
            Change input
          </button>
        </section>
      )}
      {fileError || error || lookup.isError ? (
        <p className="form-error" role="alert">
          {fileError || error || messageFromError(lookup.error)}
        </p>
      ) : null}
      <div className="form-actions">
        <button
          className="button primary"
          disabled={busy || Boolean(fileError)}
          type="submit"
        >
          {busy
            ? lookup.isPending
              ? 'Reading paper…'
              : 'Saving…'
            : preview
              ? 'Save paper'
              : 'Preview import'}
        </button>
      </div>
    </form>
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
        <h2>Find a change worth testing</h2>
        <p className="muted">
          Discover relevant research, inspect its evidence, and review
          applicability with your coding agent. Select a saved paper to read its
          details.
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
      {document.importNotes?.length ? (
        <details>
          <summary>Import provenance</summary>
          <ul>
            {document.importNotes.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="muted">
        {document.authors.join(', ') || 'Authors not recorded'}
      </p>
      <div className="paper-action">
        <p>Turn this research into a measured change.</p>
        <Link
          className="button primary"
          to={`/projects/${projectId}/experiments?view=prepare&paper=${document.id}`}
        >
          Start experiment
        </Link>
      </div>
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
