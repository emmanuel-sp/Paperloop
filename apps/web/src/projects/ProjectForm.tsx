import { useState, type FormEvent } from 'react';
import type { CreateProjectRequest } from '@paperloop/contracts';

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
  const [repositoryKind, setRepositoryKind] = useState<'none' | 'local' | 'github'>('none');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localPath = String(form.get('localPath') ?? '').trim();
    const githubOwner = String(form.get('githubOwner') ?? '').trim();
    const githubRepository = String(form.get('githubRepository') ?? '').trim();

    onSubmit({
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      objectives: lines(String(form.get('objectives') ?? '')),
      constraints: lines(String(form.get('constraints') ?? '')),
      ...(repositoryKind === 'local'
        ? { repository: { kind: 'local', path: localPath } }
        : repositoryKind === 'github'
          ? {
              repository: {
                kind: 'github',
                owner: githubOwner,
                repository: githubRepository,
              },
            }
          : {}),
    });
  }

  return (
    <section className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Project setup</p>
          <h1>Create a project</h1>
          <p>Capture the problem first. Repository access can be added now or later.</p>
        </div>
      </div>
      <form className="project-form" onSubmit={submit}>
        <label>
          Project name
          <input name="name" required maxLength={120} placeholder="Retrieval quality lab" />
        </label>
        <label>
          What does this project do?
          <textarea
            name="description"
            required
            rows={5}
            placeholder="Describe the product, its users, and the problem you want to improve."
          />
        </label>
        <div className="form-columns">
          <label>
            Objectives <span>One per line</span>
            <textarea name="objectives" rows={4} placeholder="Improve answer grounding" />
          </label>
          <label>
            Constraints <span>One per line</span>
            <textarea name="constraints" rows={4} placeholder="Keep p95 latency below 500ms" />
          </label>
        </div>
        <fieldset>
          <legend>Repository context</legend>
          <div className="segmented-control">
            {(['none', 'local', 'github'] as const).map((kind) => (
              <label key={kind}>
                <input
                  checked={repositoryKind === kind}
                  name="repositoryKind"
                  onChange={() => setRepositoryKind(kind)}
                  type="radio"
                  value={kind}
                />
                <span>{kind === 'none' ? 'Add later' : kind === 'local' ? 'Local directory' : 'GitHub'}</span>
              </label>
            ))}
          </div>
          {repositoryKind === 'local' ? (
            <label>
              Absolute directory path
              <input name="localPath" required placeholder="/home/me/projects/my-app" />
            </label>
          ) : null}
          {repositoryKind === 'github' ? (
            <div className="form-columns">
              <label>
                GitHub owner
                <input name="githubOwner" required placeholder="openai" />
              </label>
              <label>
                Repository
                <input name="githubRepository" required placeholder="example" />
              </label>
            </div>
          ) : null}
        </fieldset>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <button className="button primary" disabled={isPending} type="submit">
            {isPending ? 'Creating project…' : 'Create project'}
          </button>
        </div>
      </form>
    </section>
  );
}
