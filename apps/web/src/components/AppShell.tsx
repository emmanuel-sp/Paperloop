import type { ReactNode } from 'react';
import type { Project } from '@paperloop/contracts';
import { Link } from 'react-router';
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
  return (
    <div className="app-frame">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Paperloop home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Paperloop</span>
        </Link>
        <div className="service-chip">
          <span aria-hidden="true" /> Local service
        </div>
      </header>
      <div className="shell-grid">
        <ProjectSidebar
          activeProjectId={activeProjectId}
          activeTab={activeTab}
          projects={projects}
        />
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
