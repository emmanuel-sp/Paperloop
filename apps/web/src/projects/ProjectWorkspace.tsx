import { ScheduleWorkspace } from '../schedules/ScheduleWorkspace';
import type { Project } from '@paperloop/contracts';
import { Link, useSearchParams } from 'react-router';
import { ResearchWorkspace } from '../research/ResearchWorkspace';
import { EvaluationWorkspace } from '../evaluations/EvaluationWorkspace';
import { ExperimentWorkspace } from '../experiments/ExperimentWorkspace';

import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { SectionHeading } from '../components/SectionHeading';
import { projectSections } from './navigation';
import { ProjectActivity } from './ProjectActivity';
interface ProjectWorkspaceProps {
  activeTab: string;
  project: Project;
}

export function ProjectWorkspace({
  activeTab,
  project,
}: ProjectWorkspaceProps) {
  const [params, setParams] = useSearchParams();
  const evaluationParams = new URLSearchParams(params);
  evaluationParams.set('view', 'evaluation');
  return (
    <>
      <header className="project-header">
        <div>
          <p className="eyebrow">Project workbench</p>
          <h1>
            {
              projectSections.find((section) => section.slug === activeTab)
                ?.label
            }
          </h1>
          <p>
            {
              projectSections.find((section) => section.slug === activeTab)
                ?.description
            }
          </p>
        </div>
        <ContextBadge project={project} />
      </header>
      {activeTab === 'overview' ? (
        <div className="research-stack">
          <section className="overview-lead">
            <div className="overview-lead-copy">
              <h2>{project.name}</h2>
              <p>{project.description || project.currentContext.summary}</p>
              <Link
                className="button primary"
                to={`/projects/${project.id}/research`}
              >
                Discover research <Icon name="arrow" />
              </Link>
            </div>
            <div className="overview-visual">
              <img
                src="/images/research-loop.png"
                width="1280"
                height="1280"
                alt=""
                fetchPriority="high"
              />
            </div>
          </section>
          <nav className="overview-loop" aria-label="Research workflow">
            <Link to={`/projects/${project.id}/research`}>
              <Icon name="research" />
              <span>
                Discover<span>Find relevant ideas</span>
              </span>
              <Icon name="arrow" />
            </Link>
            <Link to={`/projects/${project.id}/research?view=recommendations`}>
              <Icon name="agent" />
              <span>
                Assess<span>Review agent proposals</span>
              </span>
              <Icon name="arrow" />
            </Link>
            <Link to={`/projects/${project.id}/experiments`}>
              <Icon name="experiments" />
              <span>
                Measure<span>Inspect the evidence</span>
              </span>
              <Icon name="arrow" />
            </Link>
          </nav>
          <ProjectActivity projectId={project.id} />
          <ProjectOverview project={project} />
        </div>
      ) : activeTab === 'research' ? (
        <ResearchWorkspace key={project.id} projectId={project.id} />
      ) : activeTab === 'schedules' || activeTab === 'settings' ? (
        <ScheduleWorkspace
          key={`${project.id}-${activeTab}`}
          projectId={project.id}
          view={activeTab}
        />
      ) : activeTab === 'experiments' ? (
        <div className="research-stack">
          <SectionHeading
            title="Progress & evidence"
            description="Inspect a focused change and decide what the results support."
            action={
              <Link
                className="button tertiary"
                to={`/projects/${project.id}/experiments?${evaluationParams}`}
              >
                Review Evaluation
              </Link>
            }
          />
          <ExperimentWorkspace
            key={project.id}
            projectId={project.id}
            repository={project.repository}
          />
          <Dialog
            open={params.get('view') === 'evaluation'}
            title="Evaluation"
            description="Review the exact metrics, inputs, and command before approving a version."
            wide
            onClose={() =>
              setParams(
                (previous) => {
                  const updated = new URLSearchParams(previous);
                  updated.delete('view');
                  return updated;
                },
                { replace: true },
              )
            }
          >
            <EvaluationWorkspace key={project.id} projectId={project.id} />
          </Dialog>
        </div>
      ) : null}
    </>
  );
}

function ContextBadge({ project }: { project: Project }) {
  const capturedAt = new Date(project.currentContext.capturedAt);
  return (
    <div className="context-badge">
      <span>Context v{project.currentContext.version}</span>
      <strong>{project.currentContext.sourceKind.replace('_', ' ')}</strong>
      <small>{capturedAt.toLocaleDateString()}</small>
    </div>
  );
}

function ProjectOverview({ project }: { project: Project }) {
  return (
    <div className="overview-grid">
      <section className="detail-panel overview-main overview-context">
        <SectionHeading
          eyebrow="Working context"
          title="What you’re building"
        />
        <p className="context-summary">
          {project.description || project.currentContext.summary}
        </p>
        <details>
          <summary>Context & provenance</summary>
          <p>{project.currentContext.summary}</p>
          {project.currentContext.inference ? (
            <div>
              <p>Suggested from read-only repository metadata on {new Date(project.currentContext.inference.capturedAt).toLocaleString()}.</p>
              <p>Research direction: {project.currentContext.inference.researchDirection || 'Not specified'}</p>
              <p>Inspected files: {project.currentContext.inference.files.map((file) => file.path).join(', ') || 'None'}</p>
              <p>Corrections: {project.currentContext.inference.correctedFields.join(', ') || 'No changes to the suggestion'}</p>
              <ul>{project.currentContext.inference.uncertainty.map((value) => <li key={value}>{value}</li>)}</ul>
            </div>
          ) : null}
          <dl className="provenance-list">
            <div>
              <dt>Source</dt>
              <dd>
                {project.currentContext.sourceReference ??
                  'Project description'}
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
        </details>
        <Link className="text-link" to={`/projects/${project.id}/research`}>
          Explore research →
        </Link>
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
