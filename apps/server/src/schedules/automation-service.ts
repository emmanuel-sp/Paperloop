import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  automationRuleSchema,
  automatedExperimentSchema,
  type AutomationRule,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import {
  automationRules,
  automationExperiments,
  researchRecommendations,
  appState,
} from '../storage/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import type { PlanService } from '../evaluations/plan-service.js';
import type { ExperimentService } from '../experiments/experiment-service.js';
import { WorkflowError } from '../evaluations/plan-service.js';
export interface AutomationReservation {
  projectId: string;
  recommendationId: string;
  experimentId: string;
  maxRuns: number;
  attempts: number;
  state: 'creating' | 'interrupted' | 'completed' | 'reconciled';
  evidence: string;
}
export class AutomationService {
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
    private readonly plans: PlanService,
    private readonly experiments: ExperimentService,
    private readonly now: () => Date,
  ) {
    for (const reservation of this.reservations()) {
      if (reservation.state !== 'creating') continue;
      try {
        const experiment = this.experiments.get(reservation.experimentId);
        this.database.db
          .insert(automationExperiments)
          .values({
            experimentId: experiment.id,
            projectId: reservation.projectId,
            recommendationId: reservation.recommendationId,
            maxRuns: reservation.maxRuns,
          })
          .onConflictDoNothing()
          .run();
        this.saveReservation({ ...reservation, state: 'completed' });
      } catch {
        this.saveReservation({ ...reservation, state: 'interrupted' });
      }
    }
  }
  rule(projectId: string) {
    this.projects.get(projectId);
    const row = this.database.db
      .select()
      .from(automationRules)
      .where(eq(automationRules.projectId, projectId))
      .get();
    return {
      rule: row?.payload ?? null,
      approvedAt: row?.approvedAt ?? null,
      usedExperiments: this.reservations(projectId).reduce(
        (sum, item) => sum + item.attempts,
        0,
      ),
      reservations: this.reservations(projectId).filter(
        (item) => item.state === 'interrupted' || item.state === 'creating',
      ),
    };
  }
  approveRule(projectId: string, input: AutomationRule) {
    this.projects.get(projectId);
    const rule = automationRuleSchema.parse(input);
    const plan = this.plans.requireApproved(rule.planId);
    if (plan.projectId !== projectId)
      throw new WorkflowError(
        'WRONG_PROJECT',
        'Choose this project’s approved evaluation plan.',
      );
    this.database.db
      .insert(automationRules)
      .values({
        projectId,
        payload: rule,
        approvedAt: this.now().toISOString(),
      })
      .onConflictDoUpdate({
        target: automationRules.projectId,
        set: { payload: rule, approvedAt: this.now().toISOString() },
      })
      .run();
    return this.rule(projectId);
  }
  automate(projectId: string, input: unknown) {
    const value = automatedExperimentSchema.parse(input);
    const reserved = this.database.db.transaction(() => {
      const { rule, usedExperiments } = this.rule(projectId);
      if (
        !rule?.enabled ||
        !rule.goals.includes(value.goal) ||
        !rule.categories.includes(value.category)
      )
        throw new WorkflowError(
          'AUTOMATION_NOT_AUTHORIZED',
          'Goal and category must match an enabled workbench-approved rule.',
        );
      if (value.experiment.planId !== rule.planId)
        throw new WorkflowError(
          'AUTOMATION_PLAN_MISMATCH',
          'Use the exact approved rule plan.',
        );
      this.plans.requireApproved(rule.planId);
      const recommendation = this.database.db
        .select()
        .from(researchRecommendations)
        .where(eq(researchRecommendations.id, value.recommendationId))
        .get()?.payload;
      if (
        !recommendation ||
        recommendation.projectId !== projectId ||
        recommendation.documentId !== value.experiment.documentId ||
        ['dismissed', 'tested'].includes(recommendation.state)
      )
        throw new WorkflowError(
          'RECOMMENDATION_INELIGIBLE',
          'Choose an untested, non-dismissed recommendation for this document.',
        );
      if (
        recommendation.proposal.projectContextVersion !==
        this.projects.get(projectId).currentContext.version
      )
        throw new WorkflowError(
          'STALE_RECOMMENDATION',
          'Reanalyze this recommendation against current project context.',
        );
      const prior = this.database.db
        .select()
        .from(automationExperiments)
        .where(
          eq(automationExperiments.recommendationId, value.recommendationId),
        )
        .get();
      if (prior) return { existing: prior.experimentId };
      const previous = this.reservations(projectId).find(
        (item) => item.recommendationId === value.recommendationId,
      );
      if (previous && previous.state !== 'reconciled')
        throw new WorkflowError(
          'AUTOMATION_INTERRUPTED',
          'Inspect and reconcile the reserved automation workspace before retrying.',
        );
      if (usedExperiments >= rule.maxExperiments)
        throw new WorkflowError(
          'EXPERIMENT_LIMIT',
          'Approved experiment count reached.',
        );
      if (
        this.experiments
          .list(projectId)
          .some((item) => item.status !== 'completed') ||
        this.reservations(projectId).some((item) =>
          ['creating', 'interrupted'].includes(item.state),
        )
      )
        throw new WorkflowError(
          'PROJECT_BUSY',
          'Complete or reconcile existing experiment work before automating another.',
        );
      const reservation: AutomationReservation = {
        projectId,
        recommendationId: value.recommendationId,
        experimentId: randomUUID(),
        maxRuns: rule.maxRuns,
        attempts: (previous?.attempts ?? 0) + 1,
        state: 'creating',
        evidence: '',
      };
      this.saveReservation(reservation);
      return { reservation };
    });
    if (reserved.existing) return this.experiments.detail(reserved.existing);
    const reservation = reserved.reservation!;
    // Git/filesystem preparation runs outside the reservation transaction.
    try {
      const result = this.experiments.create(
        projectId,
        value.experiment,
        reservation.experimentId,
      );
      this.database.db.transaction(() => {
        this.database.db
          .insert(automationExperiments)
          .values({
            projectId,
            experimentId: result.experiment.id,
            recommendationId: value.recommendationId,
            maxRuns: reservation.maxRuns,
          })
          .run();
        this.saveReservation({ ...reservation, state: 'completed' });
      });
      return result;
    } catch (error) {
      this.saveReservation({ ...reservation, state: 'interrupted' });
      throw error;
    }
  }
  reconcileAutomation(
    projectId: string,
    recommendationId: string,
    evidence: string,
  ) {
    const reservation = this.reservations(projectId).find(
      (item) => item.recommendationId === recommendationId,
    );
    if (!reservation || reservation.state !== 'interrupted')
      throw new WorkflowError(
        'AUTOMATION_RECONCILIATION_UNAVAILABLE',
        'Inspect a stopped interrupted reservation.',
      );
    // A created experiment must retain its budget mapping and use normal
    // implementation reconciliation; it must never be silently recreated.
    const existing = this.database.db
      .select()
      .from(automationExperiments)
      .where(eq(automationExperiments.experimentId, reservation.experimentId))
      .get();
    if (existing)
      throw new WorkflowError(
        'EXPERIMENT_EXISTS',
        'Use the existing experiment and its reconciliation flow.',
      );
    this.saveReservation({ ...reservation, state: 'reconciled', evidence });
    return this.rule(projectId);
  }
  private reservations(projectId?: string): AutomationReservation[] {
    const rows = this.database.sqlite
      .prepare(
        "SELECT value FROM app_state WHERE key LIKE 'automation-reservation:%'",
      )
      .all() as Array<{ value: string }>;
    return rows
      .map((row) => JSON.parse(row.value) as AutomationReservation)
      .filter((item) => !projectId || item.projectId === projectId);
  }
  private saveReservation(value: AutomationReservation) {
    const key = `automation-reservation:${value.projectId}:${value.recommendationId}`;
    this.database.db
      .insert(appState)
      .values({ key, value: JSON.stringify(value), updatedAt: this.now() })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value: JSON.stringify(value), updatedAt: this.now() },
      })
      .run();
  }
}
