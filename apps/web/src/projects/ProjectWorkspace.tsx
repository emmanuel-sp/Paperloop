import { ScheduleWorkspace } from '../schedules/ScheduleWorkspace';
import type { Project } from '@paperloop/contracts';
import { NavLink } from 'react-router';
import { SourceWorkspace } from '../research/SourceWorkspace';
import { ResearchWorkspace } from '../research/ResearchWorkspace';
import { EvaluationWorkspace } from '../evaluations/EvaluationWorkspace';
import { ExperimentWorkspace } from '../experiments/ExperimentWorkspace';

const tabs = [
  ['overview', 'Overview'],
  ['research', 'Research'],
  ['evaluations', 'Evaluations'],
  ['experiments', 'Experiments'],
  ['sources', 'Sources & schedules'],
] as const;

interface ProjectWorkspaceProps {
  activeTab: string;
  project: Project;
}

export function ProjectWorkspace({
  activeTab,
  project,
}: ProjectWorkspaceProps) {
  return (
    <>
      <section className="project-header">
        <div>
          <p className="eyebrow">Project workspace</p>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
        </div>
        <ContextBadge project={project} />
      </section>
      <nav className="tabs" aria-label="Project sections">
        {tabs.map(([slug, label]) => (
          <NavLink key={slug} to={`/projects/${project.id}/${slug}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      {activeTab === 'overview' ? (
        <ProjectOverview project={project} />
      ) : activeTab === 'research' ? (
        <ResearchWorkspace key={project.id} projectId={project.id} />
      ) : activeTab === 'sources' ? (
        <div className="research-stack">
          <SourceWorkspace key={project.id} projectId={project.id} />
          <ScheduleWorkspace
            key={`schedule-${project.id}`}
            projectId={project.id}
          />
        </div>
      ) : activeTab === 'evaluations' ? (
        <EvaluationWorkspace key={project.id} projectId={project.id} />
      ) : activeTab === 'experiments' ? (
        <ExperimentWorkspace key={project.id} projectId={project.id} />
      ) : (
        <section className="detail-panel placeholder-panel">
          <p className="eyebrow">Coming in this milestone sequence</p>
          <h2>
            {tabs.find(([slug]) => slug === activeTab)?.[1] ?? 'Project detail'}
          </h2>
          <p>
            This workspace route is ready for its feature workflow while
            preserving your project selection.
          </p>
        </section>
      )}
    </>
  );
}

function ContextBadge({ project }: { project: Project }) {
  const capturedAt = new Date(project.currentContext.capturedAt);
  return (
    <div className="context-badge">
      <span>Context v{project.currentContext.version}</span>
      <strong>{project.currentContext.sourceKind.replace('_', ' ')}</strong>
      <small>Updated {capturedAt.toLocaleString()}</small>
    </div>
  );
}

function ProjectOverview({ project }: { project: Project }) {
  return (
    <div className="overview-grid">
      <section className="detail-panel overview-main">
        <p className="eyebrow">Current context</p>
        <h2>What Paperloop knows</h2>
        <p className="context-summary">{project.currentContext.summary}</p>
        <dl className="provenance-list">
          <div>
            <dt>Source</dt>
            <dd>
              {project.currentContext.sourceReference ?? 'Project description'}
            </dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>
              {project.currentContext.repositoryRevision ?? 'Not available'}
            </dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>
              {new Date(project.currentContext.capturedAt).toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>
      <div className="overview-stack">
        <ListCard
          title="Objectives"
          items={project.objectives}
          empty="No objectives added yet."
        />
        <ListCard
          title="Constraints"
          items={project.constraints}
          empty="No constraints added yet."
        />
      </div>
    </div>
  );
}

function ListCard({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <section className="detail-panel list-card">
      <h2>{title}</h2>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
}
