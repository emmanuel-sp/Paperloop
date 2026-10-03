import { AsyncState } from '../components/AsyncState';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SourceSelection } from '@paperloop/contracts';
import {
  sourceCatalog,
  projectSources,
  selectSources,
  errorMessage,
} from './discovery-client';

export function SourceWorkspace({ projectId }: { projectId: string }) {
  const catalog = useQuery({
    queryKey: ['source-catalog'],
    queryFn: sourceCatalog,
  });
  const current = useQuery({
    queryKey: ['projects', projectId, 'sources'],
    queryFn: () => projectSources(projectId),
  });
  if (catalog.isPending || current.isPending)
    return (
      <AsyncState
        kind="loading"
        title="Loading research sources"
        description="Opening the source catalog and this project’s selections…"
      />
    );
  if (catalog.isError || current.isError)
    return (
      <AsyncState
        kind="error"
        title="Sources could not load"
        description={errorMessage(catalog.error ?? current.error)}
        action={{
          label: 'Try again',
          onClick: () => {
            void catalog.refetch();
            void current.refetch();
          },
        }}
      />
    );
  return (
    <SourceEditor
      key={JSON.stringify(current.data.selection)}
      projectId={projectId}
      initial={current.data.selection}
      suggested={current.data.selectionOrigin === 'suggested'}
      catalog={catalog.data}
    />
  );
}
function SourceEditor({
  projectId,
  initial,
  suggested,
  catalog,
}: {
  projectId: string;
  initial: SourceSelection;
  suggested: boolean;
  catalog: Awaited<ReturnType<typeof sourceCatalog>>;
}) {
  const [selection, setSelection] = useState(initial);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedName, setFeedName] = useState('');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => selectSources(projectId, selection),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['projects', projectId, 'sources'],
      });
    },
  });
  function toggle(
    key: 'collectionIds' | 'sourceIds' | 'excludedSourceIds',
    id: string,
  ) {
    setSelection((old) => ({
      ...old,
      [key]: old[key].includes(id)
        ? old[key].filter((value) => value !== id)
        : [...old[key], id],
    }));
  }
  function addFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelection((old) => ({
      ...old,
      feeds: [
        ...old.feeds.filter((feed) => feed.url !== feedUrl),
        { name: feedName, url: feedUrl },
      ],
    }));
    setFeedName('');
    setFeedUrl('');
  }
  const collectionSources = new Set(
    catalog.collections
      .filter((item) => selection.collectionIds.includes(item.id))
      .flatMap((item) => item.sourceIds),
  );
  return (
    <section className="detail-panel research-stack">
      <div>
        <p className="eyebrow">Research sources</p>
        <h2>Choose what this project follows</h2>
        <p className="muted">
          {suggested ? 'Suggested from project context. Track can use these sources now; save to customize.' : 'Your saved selections apply to this project. Save changes before collecting.'}
        </p>
      </div>
      <fieldset className="source-options">
        <legend>Collections</legend>
        {catalog.collections.map((item) => (
          <label key={item.id}>
            <input
              name="collection"
              autoComplete="off"
              type="checkbox"
              checked={selection.collectionIds.includes(item.id)}
              onChange={() => toggle('collectionIds', item.id)}
            />
            <span>
              <strong>{item.name}</strong>
              <small>{item.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <details>
        <summary>Individual source overrides</summary>
        <fieldset className="source-options">
          <legend>Individual sources</legend>
          {catalog.sources.map((item) => {
            const enabled =
              (collectionSources.has(item.id) ||
                selection.sourceIds.includes(item.id)) &&
              !selection.excludedSourceIds.includes(item.id);
            return (
              <label key={item.id}>
                <input
                  name="source"
                  autoComplete="off"
                  type="checkbox"
                  checked={enabled}
                  onChange={() =>
                    setSelection((old) => ({
                      ...old,
                      sourceIds: enabled
                        ? old.sourceIds.filter((id) => id !== item.id)
                        : [
                            ...old.sourceIds.filter((id) => id !== item.id),
                            item.id,
                          ],
                      excludedSourceIds: enabled
                        ? [
                            ...old.excludedSourceIds.filter(
                              (id) => id !== item.id,
                            ),
                            item.id,
                          ]
                        : old.excludedSourceIds.filter((id) => id !== item.id),
                    }))
                  }
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.coverage}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
      </details>
      <details>
        <summary>Add an RSS or Atom feed</summary>
        <form className="research-form" onSubmit={addFeed}>
          <h3>Add an RSS or Atom feed</h3>
          <label>
            Feed name
            <input
              name="feedName"
              autoComplete="off"
              required
              maxLength={200}
              value={feedName}
              onChange={(event) => setFeedName(event.target.value)}
            />
          </label>
          <label>
            Public feed URL
            <input
              name="feedUrl"
              autoComplete="off"
              type="url"
              required
              value={feedUrl}
              onChange={(event) => setFeedUrl(event.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={selection.feeds.length >= 20}
            type="submit"
          >
            Add feed to selection
          </button>
        </form>
      </details>
      {selection.feeds.map((feed) => (
        <div className="detail-title-row" key={feed.url}>
          <span>
            {feed.name} · {feed.url}
          </span>
          <button
            className="button"
            onClick={() =>
              setSelection((old) => ({
                ...old,
                feeds: old.feeds.filter((item) => item.url !== feed.url),
              }))
            }
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      {save.isError ? (
        <p role="alert" className="form-error">
          {errorMessage(save.error)}
        </p>
      ) : null}
      <button
        className="button primary"
        disabled={save.isPending}
        onClick={() => save.mutate()}
        type="button"
      >
        {save.isPending ? 'Saving…' : 'Save sources'}
      </button>
    </section>
  );
}
