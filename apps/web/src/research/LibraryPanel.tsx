import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  searchLibrary,
  attachDocument,
  errorMessage,
} from './discovery-client';

export function LibraryPanel({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect(id: string): void;
}) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [global, setGlobal] = useState(false);
  const [offset, setOffset] = useState(0);
  const client = useQueryClient();
  const results = useQuery({
    queryKey: ['research-library', projectId, global, query, offset],
    queryFn: () => searchLibrary(global ? undefined : projectId, query, offset),
  });
  const attach = useMutation({
    mutationFn: (documentId: string) => attachDocument(projectId, documentId),
    onSuccess: async (document) => {
      onSelect(document.id);
      await client.invalidateQueries({
        queryKey: ['projects', projectId, 'research'],
      });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(draft);
    setOffset(0);
  }
  return (
    <section className="detail-panel research-stack">
      <div>
        <p className="eyebrow">Local library</p>
        <h2>Your research library</h2>
      </div>
      <form className="research-form" onSubmit={submit}>
        <label>
          Search title, authors, or extracted text
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={global}
            onChange={(event) => {
              setGlobal(event.target.checked);
              setOffset(0);
            }}
          />
          Search across all projects
        </label>
        <button className="button" type="submit">
          Search library
        </button>
      </form>
      {results.isPending ? (
        <p role="status">Searching local library…</p>
      ) : results.isError ? (
        <p role="alert">{errorMessage(results.error)}</p>
      ) : results.data.documents.length ? (
        <div className="research-list">
          {results.data.documents.map((document) => (
            <button
              className="research-item"
              key={document.id}
              disabled={attach.isPending}
              onClick={() =>
                global ? attach.mutate(document.id) : onSelect(document.id)
              }
              type="button"
            >
              <span>{document.title}</span>
              <small>
                {document.extractionStatus} ·{' '}
                {global ? 'Open in this project' : document.sourceReference}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-inline">
          <h3>{query ? 'No matching papers' : 'Your library is empty'}</h3>
          <p>
            {query
              ? 'Try a shorter search or search across all projects.'
              : 'Add a paper or discover research from your selected sources.'}
          </p>
        </div>
      )}
      {attach.isError ? <p role="alert">{errorMessage(attach.error)}</p> : null}
      <div className="form-actions">
        <button
          className="button"
          disabled={!offset}
          type="button"
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous
        </button>
        <button
          className="button"
          disabled={results.data?.nextOffset == null}
          type="button"
          onClick={() => setOffset(results.data?.nextOffset ?? offset)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
