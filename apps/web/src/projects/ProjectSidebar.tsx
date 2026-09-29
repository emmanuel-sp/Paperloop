import type { Project } from '@paperloop/contracts';
import { Link } from 'react-router';

interface ProjectSidebarProps {
  activeProjectId?: string | undefined;
  activeTab?: string | undefined;
  projects: Project[];
}

export function ProjectSidebar({
  activeProjectId,
  activeTab = 'overview',
  projects,
}: ProjectSidebarProps) {
  return (
    <aside className="project-sidebar" aria-label="Projects">
      <div className="sidebar-heading">
        <p className="eyebrow">Workspace</p>
        <h2>Projects</h2>
      </div>
      <nav className="project-list" aria-label="Project list">
        {projects.map((project) => (
          <Link
            className={project.id === activeProjectId ? 'project-link active' : 'project-link'}
            key={project.id}
            to={`/projects/${project.id}/${activeTab}`}
          >
            <span className="project-monogram" aria-hidden="true">
              {project.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{project.name}</strong>
              <small>{project.repository?.kind ?? 'Description only'}</small>
            </span>
          </Link>
        ))}
      </nav>
      <Link className="button primary sidebar-action" to="/projects/new">
        <span aria-hidden="true">＋</span> New project
      </Link>
    </aside>
  );
}
