import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  projectOnboardingPreviewSchema,
  type CreateProjectRequest,
  type GithubRepository,
  type ProjectRepository,
  type ProjectOnboardingPreview,
} from '@paperloop/contracts';
import { AutoTextarea } from '../components/AutoTextarea';
import { request } from '../api/client';
import { GithubRepositoryPicker } from './GithubRepositoryPicker';

interface ProjectFormProps {
  error?: string | undefined;
  isPending: boolean;
  onResetError?(): void;
  onSubmit(input: CreateProjectRequest): void;
}
const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function ProjectForm({
  error,
  isPending,
  onSubmit,
  onResetError,
}: ProjectFormProps) {
  const [step, setStep] = useState<'identity' | 'context'>('identity');
  const [name, setName] = useState('');
  const [repositoryKind, setRepositoryKind] = useState<
    'none' | 'local' | 'github'
  >('none');
  const [github, setGithub] = useState<GithubRepository | null>(null);
  const [localPath, setLocalPath] = useState('');
  const [preview, setPreview] = useState<ProjectOnboardingPreview | null>(null);
  const [description, setDescription] = useState('');
  const [objectives, setObjectives] = useState('');
  const [constraints, setConstraints] = useState('');
  const [direction, setDirection] = useState('');
  const dirty = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const repository: ProjectRepository | undefined =
    repositoryKind === 'local'
      ? { kind: 'local', path: localPath.trim() }
      : repositoryKind === 'github' && github
        ? { kind: 'github', owner: github.owner, repository: github.repository }
        : undefined;
  const inspect = useMutation({
    mutationFn: async () =>
      projectOnboardingPreviewSchema.parse(
        await request('/api/v1/projects/onboarding', {
          method: 'POST',
          body: JSON.stringify({ name, repository }),
        }),
      ),
    onSuccess: (value) => {
      onResetError?.();
      setPreview(value);
      if (!dirty.current.has('description')) setDescription(value.description);
      if (!dirty.current.has('objectives'))
        setObjectives(value.objectives.join('\n'));
      if (!dirty.current.has('constraints'))
        setConstraints(value.constraints.join('\n'));
      if (!dirty.current.has('direction'))
        setDirection(value.inference.researchDirection);
      setStep('context');
    },
  });
  const busy = isPending || inspect.isPending;
  function changeRepository() {
    setPreview(null);
    inspect.reset();
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === 'identity') {
      inspect.mutate();
      return;
    }
    onSubmit({
      name,
      description,
      objectives: lines(objectives),
      constraints: lines(constraints),
      researchDirection: direction,
      ...(repository ? { repository } : {}),
      ...(preview ? { contextPreviewId: preview.id } : {}),
    });
  }
  return (
    <section className="form-panel onboarding-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            New project · {step === 'identity' ? '1 of 2' : '2 of 2'}
          </p>
          <h1 tabIndex={-1} ref={heading}>
            {step === 'identity'
              ? 'What are you building?'
              : 'Review project context'}
          </h1>
          <p>
            {step === 'identity'
              ? 'Choose a name and where the project lives. We’ll suggest the rest.'
              : `A starting point for ${name}. Correct anything before saving.`}
          </p>
        </div>
      </div>
      <form className="project-form" onSubmit={submit}>
        <fieldset className="onboarding-fields" disabled={busy}>
          {step === 'identity' ? (
            <>
              <label>
                Project name
                <input
                  autoComplete="off"
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Retrieval quality lab"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <fieldset>
                <legend>Repository context</legend>
                <div className="segmented-control">
                  {(['none', 'local', 'github'] as const).map((kind) => (
                    <label key={kind}>
                      <input
                        autoComplete="off"
                        checked={repositoryKind === kind}
                        name="repositoryKind"
                        onChange={() => {
                          setRepositoryKind(kind);
                          changeRepository();
                        }}
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
                      value={localPath}
                      onChange={(event) => {
                        setLocalPath(event.target.value);
                        changeRepository();
                      }}
                    />
                  </label>
                ) : null}
                {repositoryKind === 'github' ? (
                  <GithubRepositoryPicker
                    selected={github}
                    onChange={(value) => {
                      setGithub(value);
                      changeRepository();
                    }}
                  />
                ) : null}
              </fieldset>
              <p className="muted">
                Context suggestions use repository metadata and documentation.
                No API key or paid call is needed.
              </p>
            </>
          ) : (
            <>
              <label>
                What does this project do?
                <AutoTextarea
                  name="description"
                  required
                  maxLength={10_000}
                  rows={3}
                  placeholder="Describe the product and the problem you want to improve."
                  value={description}
                  onChange={(event) => {
                    dirty.current.add('description');
                    setDescription(event.target.value);
                  }}
                />
              </label>
              <div className="onboarding-summary">
                <section>
                  <h2>Objectives</h2>
                  {lines(objectives).length ? (
                    <ul>
                      {lines(objectives).map((value, index) => (
                        <li key={index}>{value}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      No explicit objectives found. Add them if useful.
                    </p>
                  )}
                </section>
                <section>
                  <h2>Constraints</h2>
                  {lines(constraints).length ? (
                    <ul>
                      {lines(constraints).map((value, index) => (
                        <li key={index}>{value}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No explicit constraints found.</p>
                  )}
                </section>
              </div>
              <details>
                <summary>
                  Adjust objectives, constraints & research direction
                </summary>
                <div className="project-form">
                  <label>
                    Objectives <span>One per line</span>
                    <AutoTextarea
                      rows={2}
                      value={objectives}
                      onChange={(event) => {
                        dirty.current.add('objectives');
                        setObjectives(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Constraints <span>One per line</span>
                    <AutoTextarea
                      rows={2}
                      value={constraints}
                      onChange={(event) => {
                        dirty.current.add('constraints');
                        setConstraints(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Research direction
                    <AutoTextarea
                      rows={2}
                      maxLength={500}
                      value={direction}
                      onChange={(event) => {
                        dirty.current.add('direction');
                        setDirection(event.target.value);
                      }}
                    />
                  </label>
                </div>
              </details>
              <section className="onboarding-evidence">
                <h2>Evaluation starting points</h2>
                {preview?.inference.evaluationCapabilities.length ? (
                  <ul>
                    {preview.inference.evaluationCapabilities.map((value) => (
                      <li key={`${value.source}:${value.name}`}>
                        {value.name}{' '}
                        <span className="muted">· {value.source}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">
                    No evaluation configuration found in the inspected files.
                    Your agent can suggest one later.
                  </p>
                )}
                <p className="muted">
                  Commands have not run. An Evaluation still needs your approval
                  before execution.
                </p>
              </section>
              <details>
                <summary>How this context was suggested</summary>
                {preview ? (
                  <>
                    <p>
                      Read-only metadata inspection ·{' '}
                      {new Date(preview.inference.capturedAt).toLocaleString()}
                    </p>
                    <p>
                      {repository?.kind === 'local'
                        ? repository.path
                        : (github?.fullName ?? 'Project description')}
                    </p>
                    <p>
                      Revision:{' '}
                      {preview.inference.repositoryRevision ?? 'Not available'}
                    </p>
                    <p>
                      Files:{' '}
                      {preview.inference.files
                        .map((file) => file.path)
                        .join(', ') || 'None'}
                    </p>
                    <ul>
                      {preview.inference.uncertainty.map((value) => (
                        <li key={value}>{value}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>
                    Repository inspection is unavailable. This context comes
                    from your description; no inferred provenance will be saved.
                  </p>
                )}
              </details>
            </>
          )}
        </fieldset>
        {inspect.isPending ? (
          <p role="status">
            Reading repository metadata… No agent or evaluation is running.
          </p>
        ) : null}
        {inspect.isError && step === 'identity' ? (
          <div className="form-error" role="alert">
            <p>{inspect.error.message}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setPreview(null);
                setStep('context');
              }}
            >
              Describe context manually
            </button>
          </div>
        ) : null}
        {error && step === 'context' ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          {step === 'context' ? (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                onResetError?.();
                setStep('identity');
              }}
            >
              Back to repository
            </button>
          ) : null}
          <button
            className="button primary"
            disabled={busy || (repositoryKind === 'github' && !github)}
            type="submit"
          >
            {isPending
              ? 'Creating project…'
              : inspect.isPending
                ? 'Reading context…'
                : step === 'identity'
                  ? 'Continue'
                  : 'Create project'}
          </button>
        </div>
      </form>
    </section>
  );
}
