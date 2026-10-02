import { type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
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
  const [params, setParams] = useSearchParams();
  const query = params.get('libraryQuery') ?? '';
  const global = params.get('scope') === 'all';
  const requestedOffset = Number(params.get('libraryOffset') ?? 0);
  const offset =
    Number.isInteger(requestedOffset) &&
    requestedOffset >= 0 &&
    requestedOffset <= 100000
      ? requestedOffset
      : 0;
  const setOffset = (next: number) =>
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set('libraryOffset', String(next));
      return updated;
    });
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
    const data = new FormData(event.currentTarget);
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set('libraryQuery', String(data.get('libraryQuery') ?? ''));
      updated.delete('libraryOffset');
      return updated;
    });
  }
  return (
    <section className="detail-panel research-stack">
      <div>
        <p className="eyebrow">Collected papers</p>
        <h2>Saved research</h2>
      </div>
      <form className="research-form" onSubmit={submit}>
        <label>
          Search title, authors, or extracted text
          <input
            name="libraryQuery"
            autoComplete="off"
            key={query}
            defaultValue={query}
            type="search"
            placeholder="Search your saved research…"
          />
        </label>
        <label className="checkbox-label">
          <input
            name="searchAllProjects"
            autoComplete="off"
            type="checkbox"
            checked={global}
            onChange={(event) => {
              const all = event.target.checked;
              setParams((previous) => {
                const updated = new URLSearchParams(previous);
                if (all) updated.set('scope', 'all');
                else updated.delete('scope');
                updated.delete('libraryOffset');
                return updated;
              });
            }}
          />
          Search across all projects
        </label>
        <button className="button" type="submit">
          Search saved research
        </button>
      </form>
      {results.isPending ? (
        <p role="status">Searching saved research…</p>
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
          <h3>{query ? 'No matching papers' : 'No saved research yet'}</h3>
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
