import { useState } from 'react';
import {
  automationStatusSchema,
  type EvaluationPlan,
} from '@paperloop/contracts';
export interface ScheduleAction {
  path: string;
  body?: unknown;
  method?: string;
}
export function AutomationRuleForm({
  base,
  status,
  plans,
  pending,
  onAction,
}: {
  base: string;
  status: ReturnType<typeof automationStatusSchema.parse>;
  plans: EvaluationPlan[];
  pending: boolean;
  onAction: (value: ScheduleAction) => void;
}) {
  const [goals, setGoals] = useState(status.rule?.goals.join('\n') ?? '');
  const [categories, setCategories] = useState(
    status.rule?.categories.join('\n') ?? '',
  );
  const [planId, setPlanId] = useState(status.rule?.planId ?? '');
  const [maxExperiments, setMaxExperiments] = useState(
    status.rule?.maxExperiments ?? 1,
  );
  const [maxRuns, setMaxRuns] = useState(status.rule?.maxRuns ?? 2);
  const [automationEnabled, setAutomationEnabled] = useState(
    status.rule?.enabled ?? false,
  );
  return (
    <form
      className="research-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAction({
          path: `${base}/automation/approve`,
          body: {
            enabled: automationEnabled,
            goals: goals.split('\n').filter(Boolean),
            categories: categories.split('\n').filter(Boolean),
            planId,
            maxExperiments,
            maxRuns,
          },
        });
      }}
    >
      <h3>Approve bounded experiments</h3>
      <p>
        Approval authorizes queued experiments only within the goals,
        categories, exact plan, and total limits below. Candidate changes remain
        available for review.
      </p>
      {status?.rule ? (
        <p>
          {status.rule.enabled ? 'Enabled' : 'Disabled'} ·{' '}
          {status.usedExperiments}/{status.rule.maxExperiments} experiments used
          · {status.rule.maxRuns} evaluations per experiment
        </p>
      ) : (
        <p>No automation rule approved.</p>
      )}
      <label>
        Approved goals (one per line)
        <textarea
          required
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
        />
      </label>
      <label>
        Change categories (one per line)
        <textarea
          required
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
        />
      </label>
      <label>
        Approved evaluation plan
        <select
          required
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <option value="">Select an approved plan</option>
          {plans
            .filter((plan) => plan.approvedAt)
            .map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.configuration.name} v{plan.version}
              </option>
            ))}
        </select>
      </label>
      <label>
        Total experiments
        <input
          type="number"
          min={1}
          max={100}
          value={maxExperiments}
          onChange={(e) => setMaxExperiments(Number(e.target.value))}
        />
      </label>
      <label>
        Evaluation runs per experiment
        <input
          type="number"
          min={1}
          max={100}
          value={maxRuns}
          onChange={(e) => setMaxRuns(Number(e.target.value))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={automationEnabled}
          onChange={(e) => setAutomationEnabled(e.target.checked)}
        />{' '}
        Enable this automation rule
      </label>
      <button className="button" disabled={pending}>
        Approve rule
      </button>
      {status?.rule?.enabled ? (
        <button
          className="button"
          type="button"
          disabled={pending}
          onClick={() =>
            onAction({
              path: `${base}/automation/approve`,
              body: { ...status!.rule!, enabled: false },
            })
          }
        >
          Disable automation
        </button>
      ) : null}
    </form>
  );
}
