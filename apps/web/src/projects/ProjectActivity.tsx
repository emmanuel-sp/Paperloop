import { AsyncState } from '../components/AsyncState';
import { SectionHeading } from '../components/SectionHeading';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  evaluationPlanListSchema,
  experimentListSchema,
  scheduleListSchema,
} from '@paperloop/contracts';
import { listResearchDocuments, request } from '../api/client';
import { WorkflowStatus, formatDate } from '../components/WorkflowStatus';

export function ProjectActivity({ projectId }: { projectId: string }) {
  const base = `/api/v1/projects/${projectId}`;
  const activity = useQuery({
    queryKey: ['activity', projectId],
    queryFn: async () => {
      const [papers, plans, experiments, schedules] = await Promise.all([
        listResearchDocuments(projectId),
        request(`${base}/evaluations`),
        request(`${base}/experiments`),
        request(`${base}/schedules`),
      ]);
      return {
        papers,
        plans: evaluationPlanListSchema.parse(plans).plans,
        experiments: experimentListSchema.parse(experiments).experiments,
        schedules: scheduleListSchema.parse(schedules),
      };
    },
    refetchInterval: 15000,
  });
  if (activity.isPending)
    return (
      <AsyncState
        kind="loading"
        title="Checking project progress"
        description="Loading research, decisions, and recent work…"
      />
    );
  if (activity.isError)
    return (
      <AsyncState
        kind="error"
        title="Activity could not load"
        description={activity.error.message}
        action={{ label: 'Try again', onClick: () => void activity.refetch() }}
      />
    );
  const { papers, plans, experiments, schedules } = activity.data;
  const notices = [
    ...plans
      .filter((p) => !p.approvedAt)
      .map((p) => ({
        title: `Review ${p.configuration.name}`,
        description:
          'Approve the command and inputs before an experiment can use this plan.',
        route: 'experiments?view=evaluation',
        kind: 'approval',
      })),
    ...experiments
      .filter((e) =>
        ['interrupted', 'pending', 'claimed', 'ready'].includes(e.status),
      )
      .map((e) => ({
        title:
          e.status === 'interrupted'
            ? 'Inspect interrupted experiment'
            : e.status === 'ready'
              ? 'Candidate is ready to evaluate'
              : e.status === 'claimed'
                ? 'Agent is implementing an idea'
                : 'Experiment is waiting for an agent',
        description: e.progress,
        route: `experiments?experiment=${e.id}`,
        kind: e.status,
      })),
    ...schedules.schedules
      .filter(
        (s) =>
          s.state === 'active' &&
          s.config.driver === 'native' &&
          s.setup !== 'reported',
      )
      .map((s) => ({
        title:
          s.setup === 'failed'
            ? 'Schedule setup failed'
            : 'Finish schedule setup',
        description:
          s.setupError ??
          'Give the handoff instructions to your agent, then check its reported setup.',
        route: 'schedules',
        kind: 'setup',
      })),
    ...schedules.jobs
      .filter((j) =>
        ['interrupted', 'failed', 'waiting_for_agent'].includes(j.status),
      )
      .map((j) => ({
        title:
          j.status === 'waiting_for_agent'
            ? 'Research is waiting for agent analysis'
            : j.status === 'failed'
              ? 'Research scan failed'
              : 'Inspect interrupted research',
        description: j.error ?? j.progress,
        route: 'schedules',
        kind: j.status,
      })),
  ];
  return (
    <>
      <div className="stat-grid">
        {[
          ['Saved research', papers.length, 'research?view=library'],
          ['Evaluation', plans.length, 'experiments?view=evaluation'],
          ['Experiments', experiments.length, 'experiments'],
          [
            'Active schedules',
            schedules.schedules.filter((s) => s.state === 'active').length,
            'schedules',
          ],
        ].map(([label, count, route]) => (
          <Link
            className="stat-card"
            key={label}
            to={`/projects/${projectId}/${route}`}
          >
            <span>{label}</span>
            <strong>{count}</strong>
          </Link>
        ))}
      </div>
      <section className="detail-panel">
        <SectionHeading
          title="Next steps"
          description="Decisions and work that need your attention."
          action={
            <span className="muted">
              {notices.length
                ? `${notices.length} to follow up`
                : 'All caught up'}
            </span>
          }
        />
        {notices.length ? (
          <div className="activity-list">
            {notices.slice(0, 8).map((notice, i) => (
              <Link
                key={`${notice.route}-${i}`}
                className="activity-row"
                to={`/projects/${projectId}/${notice.route}`}
              >
                <div>
                  <strong>{notice.title}</strong>
                  <p>{notice.description}</p>
                </div>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-inline">
            <h3>
              {papers.length
                ? 'Ready for your next idea'
                : 'Discover your next idea'}
            </h3>
            <p>
              {papers.length
                ? 'Review research, approve an Evaluation, and test a focused change.'
                : 'Discover research relevant to your project, then choose a focused change to test.'}
            </p>
            <Link
              className="button primary"
              to={`/projects/${projectId}/research?view=${papers.length ? 'recommendations' : 'discovery'}`}
            >
              {papers.length ? 'Review ideas' : 'Discover research'}
            </Link>
          </div>
        )}
      </section>
      {experiments.length ? (
        <section className="detail-panel">
          <div className="section-heading">
            <h2>Recent experiments</h2>
            <Link
              className="text-link"
              to={`/projects/${projectId}/experiments`}
            >
              View all →
            </Link>
          </div>
          {experiments.slice(0, 3).map((e) => (
            <Link
              className="activity-row"
              key={e.id}
              to={`/projects/${projectId}/experiments?experiment=${e.id}`}
            >
              <div>
                <strong>{e.progress || 'Experiment'}</strong>
                <p>{formatDate(e.createdAt)}</p>
              </div>
              <WorkflowStatus value={e.status} />
            </Link>
          ))}
        </section>
      ) : null}
    </>
  );
}
