import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  githubConnectionSchema,
  githubRepositoryListSchema,
  githubRepositorySchema,
  type GithubRepository,
} from '@paperloop/contracts';
import { request } from '../api/client';

export function GithubRepositoryPicker({
  selected,
  onChange,
}: {
  selected: GithubRepository | null;
  onChange(repository: GithubRepository | null): void;
}) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState('');
  const connection = useQuery({
    queryKey: ['github', 'connection'],
    queryFn: async () =>
      githubConnectionSchema.parse(await request('/api/v1/github/connection')),
    retry: false,
  });
  const repositories = useQuery({
    queryKey: ['github', 'repositories', query, page],
    queryFn: async () =>
      githubRepositoryListSchema.parse(
        await request(
          `/api/v1/github/repositories?${new URLSearchParams({ query, page: String(page) })}`,
        ),
      ),
    enabled: connection.isSuccess,
    retry: false,
  });
  const verify = useMutation({
    mutationFn: async (repositoryUrl: string) =>
      githubRepositorySchema.parse(
        await request('/api/v1/github/repository', {
          method: 'POST',
          body: JSON.stringify({ url: repositoryUrl }),
        }),
      ),
    onSuccess: (repository) => onChange(repository),
  });
  function search() {
    setQuery(draft.trim());
    setPage(1);
  }
  function select(repositoryUrl: string) {
    onChange(null);
    verify.mutate(repositoryUrl);
  }
  return (
    <div className="github-picker">
      <p>
        Use GitHub for research context. A local checkout is only needed when
        preparing an experiment.
      </p>
      <div className="github-connection" aria-live="polite">
        {connection.isPending || connection.isFetching ? (
          <p>Checking GitHub connection…</p>
        ) : connection.isError ? (
          <p role="alert">{connection.error.message}</p>
        ) : (
          <p>
            Connected as <strong>{connection.data.login}</strong> · Repository
            read access
          </p>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={connection.isFetching || verify.isPending}
          onClick={() => {
            onChange(null);
            verify.reset();
            void connection.refetch().then((result) => {
              if (result.isSuccess) void repositories.refetch();
            });
          }}
        >
          Retry connection
        </button>
      </div>
      <details>
        <summary>Connect or change GitHub access</summary>
        <p>
          Install GitHub CLI on the computer running Paperloop, then run{' '}
          <code>gh auth login --hostname github.com</code> there. Retry after
          signing in or switching accounts. Paperloop uses that computer’s
          active GitHub account.
        </p>
        <p>
          For restricted access, configure a fine-grained token for selected
          repositories with read-only metadata permission in the service’s{' '}
          <code>GH_TOKEN</code> environment. Private repositories require
          authorization, including any organization approval. Keep the token
          outside project files.
        </p>
      </details>
      {connection.isSuccess ? (
        <>
          <label>
            Search GitHub repositories
            <input
              autoComplete="off"
              value={draft}
              maxLength={200}
              placeholder="Repository name or owner/repository"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  search();
                }
              }}
            />
          </label>
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={search}>
              Search repositories
            </button>
            {query ? (
              <button
                className="button tertiary"
                type="button"
                onClick={() => {
                  setDraft('');
                  setQuery('');
                  setPage(1);
                }}
              >
                My repositories
              </button>
            ) : null}
          </div>
          <p className="muted">
            {query
              ? 'Search includes public repositories and private repositories your connection can access.'
              : 'Repositories owned by you or shared with your account and organizations.'}
          </p>
          {repositories.isPending ? (
            <p role="status">Loading repositories…</p>
          ) : repositories.isError ? (
            <div>
              <p role="alert">{repositories.error.message}</p>
              <button
                className="button secondary"
                type="button"
                onClick={() => void repositories.refetch()}
              >
                Retry repositories
              </button>
            </div>
          ) : (
            <>
              {repositories.data.repositories.length ? (
                <ul
                  className="github-repositories"
                  aria-label="GitHub repositories"
                >
                  {repositories.data.repositories.map((repository) => (
                    <li key={repository.fullName}>
                      <button
                        type="button"
                        disabled={verify.isPending}
                        aria-pressed={
                          selected?.fullName === repository.fullName
                        }
                        onClick={() =>
                          select(
                            `https://github.com/${repository.owner}/${repository.repository}`,
                          )
                        }
                      >
                        <strong>{repository.fullName}</strong>
                        <span>{repository.visibility} · Read access</span>
                        {repository.description ? (
                          <span>{repository.description}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status">
                  No repositories found. Try another search or paste a
                  repository URL.
                </p>
              )}
              <div className="form-actions">
                {page > 1 ? (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setPage(page - 1)}
                  >
                    Previous repositories
                  </button>
                ) : null}
                {repositories.data.hasMore ? (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setPage(page + 1)}
                  >
                    More repositories
                  </button>
                ) : null}
              </div>
            </>
          )}
          <label>
            GitHub repository URL
            <input
              inputMode="url"
              autoComplete="off"
              value={url}
              maxLength={500}
              placeholder="https://github.com/owner/repository"
              onChange={(event) => {
                setUrl(event.target.value);
                onChange(null);
                verify.reset();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (url.trim() && !verify.isPending) select(url.trim());
                }
              }}
              disabled={verify.isPending}
            />
          </label>
          <button
            className="button secondary"
            type="button"
            disabled={!url.trim() || verify.isPending}
            onClick={() => select(url.trim())}
          >
            Check repository
          </button>
        </>
      ) : null}
      {verify.isPending ? (
        <p role="status">Checking repository access…</p>
      ) : verify.isError ? (
        <p role="alert">{verify.error.message}</p>
      ) : null}
      {selected ? (
        <p role="status">
          Selected <strong>{selected.fullName}</strong> · {selected.visibility}{' '}
          · Read access
        </p>
      ) : (
        <p className="muted">
          Select or check a repository before creating the project.
        </p>
      )}
    </div>
  );
}
