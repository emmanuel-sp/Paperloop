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
    <>
      <header
        className="workspace-navigation"
        aria-label="Workspace navigation"
      >
        <Link
          className="brand"
          to="/"
          aria-label="Paperloop home"
          translate="no"
        >
          Paperloop
          <span className="brand-symbol" aria-hidden="true">
            <Icon name="loop" />
          </span>
        </Link>
        {activeProjectId ? (
          <nav
            ref={sectionNav}
            className="section-nav"
            aria-label="Project sections"
          >
            {projectSections.map(({ slug, label }) => (
              <NavLink key={slug} to={`/projects/${activeProjectId}/${slug}`}>
                {label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <p className="sidebar-hint">Research, connected to your work.</p>
        )}
        <Link className="new-project-link button primary" to="/projects/new">
          <Icon name="plus" />
          New project
        </Link>
      </header>
      <div className="workspace-context">
        <div className="project-switcher">
          <label className="sr-only" htmlFor="project-switcher">
            Project
          </label>
          <select
            id="project-switcher"
            name="project"
            autoComplete="off"
            value={activeProjectId ?? ''}
            onChange={(event) =>
              navigate(`/projects/${event.target.value}/${activeTab}`)
            }
            disabled={!projects.length}
          >
            {!activeProjectId ? (
              <option value="">Choose a project</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sidebar-footer">
          <span className="service-dot" aria-hidden="true" />
          Local workspace
        </div>
      </div>
    </>
  );
}
