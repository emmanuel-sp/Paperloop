export const projectSections = [
  {
    slug: 'overview',
    label: 'Overview',
    description: 'Your project, priorities, and next steps',
    icon: 'overview',
  },
  {
    slug: 'research',
    label: 'Research',
    description: 'Discover ideas and review the evidence',
    icon: 'research',
  },
  {
    slug: 'experiments',
    label: 'Experiments',
    description: 'Apply an idea and compare measured results',
    icon: 'experiments',
  },
  {
    slug: 'schedules',
    label: 'Schedules',
    description: 'Keep research moving on your schedule',
    icon: 'schedules',
  },
  {
    slug: 'settings',
    label: 'Settings',
    description: 'Connections, preferences, and automation controls',
    icon: 'settings',
  },
] as const;

// Keep retired bookmarks usable while the five sections become their new homes.
export const retiredProjectSections: Record<
  string,
  { slug: string; view: string }
> = {
  sources: { slug: 'research', view: 'sources' },
  library: { slug: 'research', view: 'library' },
  evaluations: { slug: 'experiments', view: 'evaluation' },
  'evaluation-plans': { slug: 'experiments', view: 'evaluation' },
  'agent-api': { slug: 'settings', view: 'agent-api' },
};
