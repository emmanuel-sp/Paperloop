import { AutoTextarea } from '../components/AutoTextarea';
import { useState, type FormEvent } from 'react';
import type {
  CreateProjectRequest,
  GithubRepository,
} from '@paperloop/contracts';
import { GithubRepositoryPicker } from './GithubRepositoryPicker';

interface ProjectFormProps {
  error?: string | undefined;
  isPending: boolean;
  onSubmit(input: CreateProjectRequest): void;
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function ProjectForm({ error, isPending, onSubmit }: ProjectFormProps) {
  const [repositoryKind, setRepositoryKind] = useState<
    'none' | 'local' | 'github'
  >('none');
  const [github, setGithub] = useState<GithubRepository | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localPath = String(form.get('localPath') ?? '').trim();
    if (repositoryKind === 'github' && !github) return;

    onSubmit({
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      objectives: lines(String(form.get('objectives') ?? '')),
      constraints: lines(String(form.get('constraints') ?? '')),
      ...(repositoryKind === 'local'
        ? { repository: { kind: 'local', path: localPath } }
        : repositoryKind === 'github' && github
          ? {
              repository: {
                kind: 'github',
                owner: github.owner,
                repository: github.repository,
              },
            }
          : {}),
    });
  }

  return (
    <section className="form-panel">
      <div className="panel-heading">
        <div>
          <h1>What are you building?</h1>
          <p>
            Capture the problem first. Repository access can be added now or
            later.
          </p>
        </div>
      </div>
      <form className="project-form" onSubmit={submit}>
        <label>
          Project name
          <input
            autoComplete="off"
            name="name"
            required
            maxLength={120}
            placeholder="Retrieval quality lab"
          />
        </label>
        <label>
          What does this project do?
          <AutoTextarea
            autoComplete="off"
            name="description"
            className="project-description"
            required
            rows={3}
            placeholder="Describe the product, its users, and the problem you want to improve."
          />
        </label>
        <div className="form-columns">
          <label>
            Objectives <span>One per line</span>
            <AutoTextarea
              autoComplete="off"
              name="objectives"
              rows={4}
              placeholder="Improve answer grounding"
            />
          </label>
          <label>
            Constraints <span>One per line</span>
            <AutoTextarea
              autoComplete="off"
              name="constraints"
              rows={4}
              placeholder="Keep p95 latency below 500ms"
            />
          </label>
        </div>
        <fieldset>
          <legend>Repository context</legend>
          <div className="segmented-control">
            {(['none', 'local', 'github'] as const).map((kind) => (
              <label key={kind}>
                <input
                  autoComplete="off"
                  checked={repositoryKind === kind}
                  name="repositoryKind"
                  onChange={() => setRepositoryKind(kind)}
                  type="radio"
                  value={kind}
                />
                <span>
                  {kind === 'none'
                    ? 'Add later'
                    : kind === 'local'
                      ? 'Local directory'
                      : 'GitHub'}
                </span>
              </label>
            ))}
          </div>
          {repositoryKind === 'local' ? (
            <label>
              Absolute directory path
              <input
                autoComplete="off"
                name="localPath"
                required
                placeholder="/home/me/projects/my-app"
              />
            </label>
          ) : null}
          {repositoryKind === 'github' ? (
            <GithubRepositoryPicker selected={github} onChange={setGithub} />
          ) : null}
        </fieldset>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            className="button primary"
            disabled={isPending || (repositoryKind === 'github' && !github)}
            type="submit"
          >
            {isPending ? 'Creating project…' : 'Create project'}
          </button>
        </div>
      </form>
    </section>
  );
}
