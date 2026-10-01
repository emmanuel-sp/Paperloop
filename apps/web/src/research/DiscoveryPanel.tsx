import { Field } from '../components/Field';
import { SectionHeading } from '../components/SectionHeading';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  projectSources,
  listScans,
  scanSources,
  fetchDocument,
  errorMessage,
} from './discovery-client';

export function DiscoveryPanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const client = useQueryClient();
  const sources = useQuery({
    queryKey: ['projects', projectId, 'sources'],
    queryFn: () => projectSources(projectId),
  });
  const scans = useQuery({
    queryKey: ['projects', projectId, 'scans'],
    queryFn: () => listScans(projectId),
  });
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['projects', projectId] });
    await client.invalidateQueries({ queryKey: ['research-library'] });
  };
  const search = useMutation({
    mutationFn: (offsets: Record<string, number>) =>
      scanSources(projectId, { query, offsets, limit: 10 }),
    onSuccess: invalidate,
  });
  const fetch = useMutation({
    mutationFn: () => fetchDocument(projectId, url),
    onSuccess: invalidate,
  });
  const latest = search.data ?? scans.data?.[0];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search.mutate({});
  }
  return (
    <section className="detail-panel research-stack">
      <SectionHeading
        eyebrow="Discovery"
        title="Find research"
        description="Explore ideas you can assess against this project’s goals."
      />
      <p className="muted">
        {sources.data?.sources.length ?? 0} sources selected.{' '}
        <Link to={`/projects/${projectId}/research?view=sources`}>
          Manage sources
        </Link>
      </p>
      <form className="research-form" onSubmit={submit}>
        <Field
          label="Research question"
          hint="Search public sources without a model API key. Analysis waits for an available agent or an explicitly enabled provider."
        >
          {(attributes) => (
            <input
              {...attributes}
              value={query}
              maxLength={500}
              placeholder="A topic or project objective"
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
        </Field>
        <button
          className="button primary"
          disabled={search.isPending || !sources.data?.sources.length}
          type="submit"
        >
          {search.isPending ? 'Searching…' : 'Search sources'}
        </button>
      </form>
      {sources.isError || scans.isError || search.isError ? (
        <p role="alert">
          {errorMessage(sources.error ?? scans.error ?? search.error)}
        </p>
      ) : null}
      {latest ? (
        <div className="scan-outcomes">
          <p role="status">
            {latest.documentIds.length} documents collected ·{' '}
            {latest.analysisStatus === 'waiting_for_agent'
              ? 'Waiting for agent analysis'
              : 'Analysis complete'}
          </p>
          {latest.outcomes.map((item) => (
            <div key={item.sourceId}>
              <strong>
                {sources.data?.sources.find(
                  (source) => source.id === item.sourceId,
                )?.name ?? item.sourceId}
              </strong>
              <p>
                {item.count} results · {item.status.replace('_', ' ')}
                {item.retryAt
                  ? ` · Retry after ${new Date(item.retryAt).toLocaleString()}`
                  : ''}
              </p>
              <small className="muted">{item.error ?? item.coverage}</small>
              {item.nextOffset !== null && item.status === 'ok' ? (
                <button
                  className="button"
                  disabled={search.isPending || query !== latest.query}
                  onClick={() =>
                    search.mutate({
                      ...Object.fromEntries(
                        latest.outcomes.map((outcome) => [
                          outcome.sourceId,
                          outcome.nextOffset ?? 0,
                        ]),
                      ),
                      [item.sourceId]: item.nextOffset!,
                    })
                  }
                  type="button"
                >
                  Next page
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          Searches store material locally. An agent can assess applicability
          when available.
        </p>
      )}
      <details>
        <summary>Add an article by URL</summary>
        <form
          className="research-form"
          onSubmit={(event) => {
            event.preventDefault();
            fetch.mutate();
          }}
        >
          <label>
            Fetch a paper or article URL
            <input
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <button className="button" disabled={fetch.isPending} type="submit">
            {fetch.isPending ? 'Extracting…' : 'Fetch and extract'}
          </button>
          {fetch.isError ? (
            <p role="alert">{errorMessage(fetch.error)}</p>
          ) : null}
          {fetch.data ? (
            <p role="status">
              {fetch.data.title} · {fetch.data.extractionStatus}
              {fetch.data.extractionError
                ? `: ${fetch.data.extractionError}`
                : ''}
            </p>
          ) : null}
        </form>
      </details>
    </section>
  );
}
