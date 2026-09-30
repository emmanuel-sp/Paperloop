import { createHash, randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  evaluationPlanDraftSchema,
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
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
    const configuration = evaluationPlanDraftSchema.parse(input);
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
    if (plan.fingerprint !== expectedFingerprint)
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
