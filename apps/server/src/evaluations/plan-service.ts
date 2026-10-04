import { createHash, randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  evaluationPlanDraftSchema,
  isEvaluationSuite,
  freezeEvaluationConfiguration,
  type LegacyEvaluationPlanDraft,
  type EvaluationPlan,
  type EvaluationPlanDraft,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import type { ProjectService } from '../projects/project-service.js';
import { evaluationPlans } from '../storage/schema.js';

export class WorkflowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
  }
}
export function fingerprint(value: unknown): string {
  const serialized =
    value &&
    typeof value === 'object' &&
    'formatVersion' in value &&
    value.formatVersion === 2
      ? JSON.stringify(canonical(value))
      : JSON.stringify(value);
  return createHash('sha256').update(serialized).digest('hex');
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
export class PlanService {
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
  ) {}
  list(projectId: string): EvaluationPlan[] {
    this.projects.get(projectId);
    return this.database.db
      .select()
      .from(evaluationPlans)
      .where(eq(evaluationPlans.projectId, projectId))
      .orderBy(desc(evaluationPlans.version))
      .all();
  }
  get(id: string): EvaluationPlan {
    const plan = this.database.db
      .select()
      .from(evaluationPlans)
      .where(eq(evaluationPlans.id, id))
      .get();
    if (!plan)
      throw new WorkflowError(
        'PLAN_NOT_FOUND',
        'Evaluation plan was not found.',
        404,
      );
    return plan;
  }
  draft(projectId: string, input: EvaluationPlanDraft): EvaluationPlan {
    this.projects.get(projectId);
    const parsed = evaluationPlanDraftSchema.parse(input);
    const configuration = isEvaluationSuite(parsed)
      ? freezeEvaluationConfiguration(parsed)
      : parsed;
    const plan = this.database.db.transaction((tx) => {
      const latest = tx
        .select()
        .from(evaluationPlans)
        .where(eq(evaluationPlans.projectId, projectId))
        .orderBy(desc(evaluationPlans.version))
        .get();
      const record: EvaluationPlan = {
        id: randomUUID(),
        projectId,
        version: (latest?.version ?? 0) + 1,
        configuration,
        fingerprint: fingerprint(configuration),
        approvedAt: null,
        createdAt: new Date().toISOString(),
      };
      tx.insert(evaluationPlans).values(record).run();
      return record;
    });
    return plan;
  }
  approve(id: string, expectedFingerprint: string): EvaluationPlan {
    const plan = this.get(id);
    if (
      plan.fingerprint !== expectedFingerprint ||
      plan.fingerprint !== fingerprint(plan.configuration)
    )
      throw new WorkflowError(
        'PLAN_CHANGED',
        'Review the exact plan version before approving.',
      );
    this.database.db
      .update(evaluationPlans)
      .set({ approvedAt: new Date().toISOString() })
      .where(eq(evaluationPlans.id, id))
      .run();
    return this.get(id);
  }
  requireExecutable(
    id: string,
  ): EvaluationPlan & { configuration: LegacyEvaluationPlanDraft } {
    const plan = this.requireApproved(id);
    if (isEvaluationSuite(plan.configuration))
      throw new WorkflowError(
        'SUITE_EXECUTION_UNAVAILABLE',
        'Layered Evaluation imports, comparisons and automation are not available yet. Use an approved single-command Evaluation for those operations.',
      );
    return { ...plan, configuration: plan.configuration };
  }
  requireApproved(id: string): EvaluationPlan {
    const plan = this.get(id);
    if (
      !plan.approvedAt ||
      plan.fingerprint !== fingerprint(plan.configuration)
    )
      throw new WorkflowError(
        'APPROVAL_REQUIRED',
        'Approve this exact evaluation plan in the workbench before execution.',
      );
    return plan;
  }
}
