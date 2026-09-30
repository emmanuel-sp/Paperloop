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
    return <p role="status">Loading research sources…</p>;
  if (catalog.isError || current.isError)
    return <p role="alert">{errorMessage(catalog.error ?? current.error)}</p>;
  return (
    <SourceEditor
      key={JSON.stringify(current.data.selection)}
      projectId={projectId}
      initial={current.data.selection}
      catalog={catalog.data}
    />
  );
}
function SourceEditor({
  projectId,
  initial,
  catalog,
}: {
  projectId: string;
  initial: SourceSelection;
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
          Collections group public sources. Save your selections before
          searching in Research.
        </p>
      </div>
      <fieldset className="source-options">
        <legend>Collections</legend>
        {catalog.collections.map((item) => (
          <label key={item.id}>
            <input
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
      <form className="research-form" onSubmit={addFeed}>
        <h3>Add an RSS or Atom feed</h3>
        <label>
          Feed name
          <input
            required
            maxLength={200}
            value={feedName}
            onChange={(event) => setFeedName(event.target.value)}
          />
        </label>
        <label>
          Public feed URL
          <input
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
