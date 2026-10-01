import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectRequest, Project } from '@paperloop/contracts';
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router';
import {
  ApiError,
  connectLocalSession,
  createProject,
  getProject,
  listProjects,
} from '../api/client';
import { AppShell } from '../components/AppShell';
import { AsyncState } from '../components/AsyncState';
import { ProjectForm } from '../projects/ProjectForm';
import {
  projectSections,
  retiredProjectSections,
} from '../projects/navigation';
import { ProjectWorkspace } from '../projects/ProjectWorkspace';

const projectQueryKey = ['projects'] as const;

export function App() {
  const projectsQuery = useQuery({
    queryKey: projectQueryKey,
    queryFn: listProjects,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 401) && count < 2,
  });

  if (projectsQuery.isPending) {
    return (
      <AppShell projects={[]}>
        <AsyncState
          kind="loading"
          title="Opening your workspace"
          description="Connecting to the local Paperloop service…"
        />
      </AppShell>
    );
  }

  if (
    projectsQuery.error instanceof ApiError &&
    projectsQuery.error.status === 401
  ) {
    return <ConnectionScreen />;
  }

  if (projectsQuery.isError) {
    return (
      <AppShell projects={[]}>
        <AsyncState
          kind="error"
          eyebrow="Connection problem"
          title="The local service is unavailable"
          description={messageFromError(projectsQuery.error)}
          action={{
            label: 'Try again',
            onClick: () => void projectsQuery.refetch(),
          }}
        />
      </AppShell>
    );
  }

  return <WorkbenchRoutes projects={projectsQuery.data} />;
}

function WorkbenchRoutes({ projects }: { projects: Project[] }) {
  return (
    <Routes>
      <Route
        path="/"
        element={
          projects.length > 0 ? (
            <Navigate replace to={`/projects/${projects[0]?.id}/overview`} />
          ) : (
            <EmptyWorkspace projects={projects} />
          )
        }
      />
      <Route
        path="/projects/new"
        element={<NewProjectPage projects={projects} />}
      />
      <Route
        path="/projects/:projectId"
        element={<ProjectPage projects={projects} />}
      />
      <Route
        path="/projects/:projectId/:tab"
        element={<ProjectPage projects={projects} />}
      />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

function EmptyWorkspace({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  return (
    <AppShell projects={projects}>
      <AsyncState
        eyebrow="Start here"
        title="Create your first project"
        description="Describe what you are building and what better looks like. Repository context is optional during setup."
        action={{
          label: 'Create project',
          onClick: () => navigate('/projects/new'),
        }}
      />
    </AppShell>
  );
}

function NewProjectPage({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectQueryKey });
      navigate(`/projects/${project.id}/overview`);
    },
  });

  return (
    <AppShell projects={projects}>
      <ProjectForm
        error={mutation.isError ? messageFromError(mutation.error) : undefined}
        isPending={mutation.isPending}
        onSubmit={(input: CreateProjectRequest) => mutation.mutate(input)}
      />
    </AppShell>
  );
}

function ProjectPage({ projects }: { projects: Project[] }) {
  const { projectId, tab = 'overview' } = useParams();
  const location = useLocation();
  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId ?? ''),
    enabled: Boolean(projectId),
  });

  if (projectQuery.isPending) {
    return (
      <AppShell projects={projects} activeProjectId={projectId} activeTab={tab}>
        <AsyncState
          kind="loading"
          title="Loading project"
          description="Retrieving the latest project context…"
        />
      </AppShell>
    );
  }

  if (projectQuery.isError) {
    return (
      <AppShell projects={projects} activeProjectId={projectId} activeTab={tab}>
        <AsyncState
          kind="error"
          eyebrow="Project unavailable"
          title="We could not open this project"
          description={messageFromError(projectQuery.error)}
          action={{
            label: 'Try again',
            onClick: () => void projectQuery.refetch(),
          }}
        />
      </AppShell>
    );
  }

  const retired = retiredProjectSections[tab];
  if (retired) {
    const params = new URLSearchParams(location.search);
    params.set('view', retired.view);
    return (
      <Navigate
        replace
        to={`/projects/${projectId}/${retired.slug}?${params}${location.hash}`}
      />
    );
  }

  if (!projectSections.some((section) => section.slug === tab))
    return <Navigate replace to={`/projects/${projectId}/overview`} />;

  return (
    <AppShell projects={projects} activeProjectId={projectId} activeTab={tab}>
      <ProjectWorkspace activeTab={tab} project={projectQuery.data} />
    </AppShell>
  );
}

function ConnectionScreen() {
  const [secret, setSecret] = useState('');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: connectLocalSession,
    onSuccess: async () => {
      setSecret('');
      await queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(secret);
  }

  return (
    <main className="connection-page">
      <section className="connection-card">
        <span className="brand-mark large" aria-hidden="true">
          P
        </span>
        <p className="eyebrow">Local connection</p>
        <h1>Welcome to Paperloop</h1>
        <p>
          Connect to your local workspace to explore research and measure what
          works. Paste the connection secret from the file shown when Paperloop
          starts.
        </p>
        <form onSubmit={submit}>
          <label>
            Connection secret
            <input
              autoComplete="off"
              autoFocus
              onChange={(event) => setSecret(event.target.value)}
              required
              type="password"
              value={secret}
            />
          </label>
          {mutation.isError ? (
            <p className="form-error" role="alert">
              {messageFromError(mutation.error)}
            </p>
          ) : null}
          <button
            className="button primary"
            disabled={mutation.isPending}
            type="submit"
          >
            {mutation.isPending ? 'Connecting…' : 'Open workspace'}
          </button>
        </form>
      </section>
    </main>
  );
}

function messageFromError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}
