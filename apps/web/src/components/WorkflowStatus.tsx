const labels: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  removed: 'Removed',
  pending: 'Waiting for agent',
  claimed: 'Agent working',
  ready: 'Ready to evaluate',
  waiting_for_agent: 'Waiting for agent',
  running: 'Running',
  completed: 'Completed',
  interrupted: 'Inspection required',
  failed: 'Failed',
  cancelled: 'Cancelled',
  improvement: 'Improvement measured',
  regression: 'Regression measured',
  no_meaningful_change: 'No meaningful change',
  inconclusive: 'Inconclusive',
  complete: 'Full text available',
  partial: 'Partial text',
  unavailable: 'Text unavailable',
};
export function WorkflowStatus({ value }: { value: string }) {
  return (
    <span className={`workflow-status status-${value}`}>
      {labels[value] ?? value.replaceAll('_', ' ')}
    </span>
  );
}
export function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
