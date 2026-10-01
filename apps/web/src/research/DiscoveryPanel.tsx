import { Field } from '../components/Field';
import { AutoTextarea } from '../components/AutoTextarea';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { WorkflowStatus } from '../components/WorkflowStatus';
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
  const [fetchOpen, setFetchOpen] = useState(false);
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
    <section className="discovery-stage">
      <div className="discovery-intro">
        <h2>Discover research</h2>
        <p>
          Search public sources for relevant papers, then ask your coding agent
          to assess the evidence.
        </p>
      </div>
      <div>
        <form className="mission-composer" onSubmit={submit}>
          <Field label="Research question">
            {(attributes) => (
              <AutoTextarea
                autoComplete="off"
                {...attributes}
                name="researchQuestion"
                value={query}
                maxLength={500}
                rows={2}
                placeholder="What would you like to improve?"
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
          </Field>
          <div className="composer-footer">
            <div className="composer-context">
              <Icon name="sources" />
              <Link to={`/projects/${projectId}/research?view=sources`}>
                {sources.isPending
                  ? 'Loading sources…'
                  : `${sources.data?.sources.length ?? 0} research sources`}
              </Link>
            </div>
            <button
              className="button primary"
              disabled={search.isPending || !sources.data?.sources.length}
              type="submit"
            >
              {search.isPending ? 'Searching…' : 'Search sources'}
              <Icon name="arrow" />
            </button>
          </div>
        </form>
        {search.isPending ? (
          <p role="status" className="workflow-notice">
            Searching public sources and collecting papers. Agent analysis has
            not started.
          </p>
        ) : null}
        {!sources.isPending &&
        !sources.isError &&
        !sources.data?.sources.length ? (
          <p className="composer-help">
            Choose{' '}
            <Link to={`/projects/${projectId}/research?view=sources`}>
              research sources
            </Link>{' '}
            to start a search.
          </p>
        ) : null}
        <p className="composer-help">
          Public-source search needs no API key. Your coding agent analyzes the
          findings; paid analysis requires separate approval.
        </p>
      </div>
      {sources.isError || scans.isError || search.isError ? (
        <p role="alert">
          {errorMessage(sources.error ?? scans.error ?? search.error)}
        </p>
      ) : null}
      {latest ? (
        <div className="scan-outcomes">
          <div role="status" className="section-heading">
            <h3>{latest.documentIds.length} documents collected</h3>
            {latest.analysisStatus === 'waiting_for_agent' ? (
              <WorkflowStatus value="waiting_for_agent" />
            ) : (
              <span className="workflow-status status-completed">
                Analysis complete
              </span>
            )}
          </div>
          {latest.analysisStatus === 'waiting_for_agent' ? (
            <p role="status" className="workflow-notice">
              Papers are ready for assessment. Waiting for a coding agent to
              take the work; collecting papers does not start an agent.
            </p>
          ) : null}
          {latest.outcomes.map((item) => (
            <div className="scan-outcome" key={item.sourceId}>
              <div>
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
              </div>
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
        <div className="research-process">
          <div>
            <span className="process-symbol">
              <Icon name="research" />
            </span>
            <h3>Discover</h3>
            <p>
              Search your selected sources. Keep the material in your local
              workspace.
            </p>
          </div>
          <div>
            <span className="process-symbol">
              <Icon name="agent" />
            </span>
            <h3>Assess</h3>
            <p>
              Your coding agent reviews applicability, evidence, and tradeoffs.
            </p>
          </div>
          <div>
            <span className="process-symbol">
              <Icon name="experiments" />
            </span>
            <h3>Test</h3>
            <p>
              Approve an evaluation. Compare a focused change against a
              baseline.
            </p>
          </div>
        </div>
      )}
      <div>
        <button
          className="button tertiary"
          type="button"
          onClick={() => setFetchOpen(true)}
        >
          Fetch an article by URL
        </button>
      </div>
      <Dialog
        open={fetchOpen}
        title="Fetch an article"
        description="Extract a known paper or article into this project’s research."
        busy={fetch.isPending}
        onClose={() => setFetchOpen(false)}
      >
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
              name="articleUrl"
              autoComplete="off"
              placeholder="https://…"
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
      </Dialog>
    </section>
  );
}
