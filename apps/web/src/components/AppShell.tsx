import { useEffect, type ReactNode } from 'react';
import type { Project } from '@paperloop/contracts';
import { useLocation } from 'react-router';
import { ProjectSidebar } from '../projects/ProjectSidebar';
interface AppShellProps {
  activeProjectId?: string | undefined;
  activeTab?: string | undefined;
  children: ReactNode;
  projects: Project[];
}
export function AppShell({
  activeProjectId,
  activeTab,
  children,
  projects,
}: AppShellProps) {
  const location = useLocation();
  useEffect(() => {
    document.title = `${projects.find((p) => p.id === activeProjectId)?.name ?? 'Workspace'} · Paperloop`;
  }, [activeProjectId, projects]);
  useEffect(() => {
    document.getElementById('workspace')?.focus({ preventScroll: true });
  }, [location.pathname]);
  return (
    <div className="app-frame">
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <ProjectSidebar
        activeProjectId={activeProjectId}
        activeTab={activeTab}
        projects={projects}
      />
      <main id="workspace" className="workspace" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
