import { useEffect, useRef } from 'react';
import type { Project } from '@paperloop/contracts';
import { Link, NavLink, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { projectSections } from './navigation';

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
  const navigate = useNavigate();
  const sectionNav = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = sectionNav.current;
    if (!nav) return;
    const revealActiveSection = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active || nav.scrollWidth <= nav.clientWidth) return;
      const item = active.getBoundingClientRect();
      const container = nav.getBoundingClientRect();
      if (item.right > container.right)
        nav.scrollLeft += item.right - container.right + 4;
      else if (item.left < container.left)
        nav.scrollLeft += item.left - container.left - 4;
    };
    revealActiveSection();
    const observer = new ResizeObserver(revealActiveSection);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeProjectId, activeTab]);
  return (
    <aside className="project-sidebar" aria-label="Workspace navigation">
      <Link className="brand" to="/" aria-label="Paperloop home">
        <span className="brand-mark" aria-hidden="true">
          P
        </span>
        Paperloop
      </Link>
      <div className="project-switcher">
        <label htmlFor="project-switcher">Project</label>
        <select
          id="project-switcher"
          value={activeProjectId ?? ''}
          onChange={(e) => navigate(`/projects/${e.target.value}/${activeTab}`)}
          disabled={!projects.length}
        >
          {!activeProjectId ? <option value="">Choose a project</option> : null}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {activeProjectId ? (
        <nav
          ref={sectionNav}
          className="section-nav"
          aria-label="Project sections"
        >
          {projectSections.map(({ slug, label, icon }) => (
            <NavLink key={slug} to={`/projects/${activeProjectId}/${slug}`}>
              <Icon name={icon} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      ) : (
        <p className="sidebar-hint">
          Bring research into the projects you care about.
        </p>
      )}
      <Link className="new-project-link" to="/projects/new">
        <Icon name="plus" />
        New project
      </Link>
      <div className="sidebar-footer">
        <span className="service-dot" aria-hidden="true" />
        Local workspace<small>Your data stays on this machine</small>
      </div>
    </aside>
  );
}
