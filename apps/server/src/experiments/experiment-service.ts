import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  evaluationResultSchema,
  type Experiment,
  type ExperimentRequest,
  type ExperimentDetail,
  type EvaluationRun,
  type EvaluationResult,
  type Comparison,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import type { ProjectService } from '../projects/project-service.js';
import type { ResearchService } from '../research/research-service.js';
import { PlanService, WorkflowError } from '../evaluations/plan-service.js';
import { executePlan, type Execution } from '../evaluations/runner.js';
import {
  experiments,
  experimentJobs,
  evaluationRuns,
  experimentComparisons,
} from '../storage/schema.js';
import { codeIdentity, prepareWorkspaces } from './workspaces.js';

export class ExperimentService {
  private readonly active = new Map<string, Execution>();
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
    private readonly research: ResearchService,
    private readonly plans: PlanService,
  ) {
    this.database.db.transaction((tx) => {
      for (const row of tx
        .select()
        .from(evaluationRuns)
        .where(eq(evaluationRuns.status, 'running'))
        .all()) {
        tx.update(evaluationRuns)
          .set({
            status: 'interrupted',
            payload: {
              ...row.payload,
              status: 'interrupted',
              error:
                'Service restarted; reconcile the workspace and any surviving processes before retrying.',
              finishedAt: new Date().toISOString(),
            },
          })
          .where(eq(evaluationRuns.id, row.id))
          .run();
        const experiment = tx
          .select()
          .from(experiments)
          .where(eq(experiments.id, row.experimentId))
          .get();
        if (experiment) {
          tx.update(experiments)
            .set({
              status: 'interrupted',
              payload: {
                ...experiment.payload,
                status: 'interrupted',
                reconciliation: null,
              },
            })
            .where(eq(experiments.id, experiment.id))
            .run();
          tx.update(experimentJobs)
            .set({ status: 'interrupted' })
            .where(eq(experimentJobs.experimentId, experiment.id))
            .run();
        }
      }
      for (const row of tx
        .select()
        .from(experiments)
        .where(eq(experiments.status, 'claimed'))
        .all()) {
        tx.update(experiments)
          .set({
            status: 'interrupted',
            payload: {
              ...row.payload,
              status: 'interrupted',
              reconciliation: null,
            },
          })
          .where(eq(experiments.id, row.id))
          .run();
        tx.update(experimentJobs)
          .set({ status: 'interrupted' })
          .where(eq(experimentJobs.experimentId, row.id))
          .run();
      }
    });
  }
  list(projectId: string): Experiment[] {
    this.projects.get(projectId);
    return this.database.db
      .select()
      .from(experiments)
      .where(eq(experiments.projectId, projectId))
      .all()
      .map((row) => row.payload);
  }
  get(id: string): Experiment {
    const row = this.database.db
      .select()
      .from(experiments)
      .where(eq(experiments.id, id))
      .get();
    if (!row)
      throw new WorkflowError(
        'EXPERIMENT_NOT_FOUND',
        'Experiment was not found.',
        404,
      );
    return row.payload;
  }
  detail(id: string): ExperimentDetail {
    const experiment = this.get(id);
    return {
      experiment,
      plan: this.plans.get(experiment.planId),
      runs: this.database.db
        .select()
        .from(evaluationRuns)
        .where(eq(evaluationRuns.experimentId, id))
        .all()
        .map((row) => row.payload),
      comparisons: this.database.db
        .select()
        .from(experimentComparisons)
        .where(eq(experimentComparisons.experimentId, id))
        .all()
        .map((row) => row.payload),
      nextActions:
        experiment.status === 'interrupted'
          ? [
              'Inspect any surviving processes and both workspaces, then record reconciliation.',
            ]
          : experiment.status === 'completed'
            ? [
                'Review comparison evidence. Candidate changes are not merged into the original project.',
              ]
            : experiment.status === 'ready'
              ? [
                  'Run the approved candidate and compare compatible baseline/candidate evidence.',
                ]
              : experiment.status === 'claimed'
                ? [
                    'Continue only in the candidate workspace and report progress with the ownership token.',
                  ]
                : [
                    'Run the approved baseline.',
                    'Claim the implementation job and change only the candidate workspace.',
                    'Report ready with the ownership token, run the candidate, and compare.',
                  ],
    };
  }
  create(projectId: string, input: ExperimentRequest): ExperimentDetail {
    const project = this.projects.get(projectId);
    const paper = this.research.get(projectId, input.documentId);
    const plan = this.plans.requireApproved(input.planId);
    if (plan.projectId !== projectId)
      throw new WorkflowError(
        'WRONG_PROJECT',
        'The evaluation plan belongs to another project.',
      );
    const existing = this.list(projectId).find(
      (item) =>
        item.documentId === input.documentId &&
        item.planId === input.planId &&
        item.status !== 'completed',
    );
    if (existing) return this.detail(existing.id);
    if (!project.repository || project.repository.kind !== 'local')
      throw new WorkflowError(
        'LOCAL_REPOSITORY_REQUIRED',
        'Register an available local repository before preparing an experiment.',
      );
    const id = randomUUID();
    const workspace = prepareWorkspaces(
      join(this.database.dataDirectory, 'experiments', id),
      project.repository.path,
      input.baselineRevision,
      input.isolatedCopy,
    );
    const experiment: Experiment = {
      id,
      projectId,
      documentId: input.documentId,
      planId: input.planId,
      contextId: project.currentContext.id,
      briefId: paper.currentBrief?.id ?? null,
      status: 'pending',
      ...workspace,
      claimToken: null,
      claimOwner: null,
      claimExpiresAt: null,
      progress: 'Waiting for an agent.',
      reconciliation: null,
      createdAt: new Date().toISOString(),
    };
    this.database.db.transaction((tx) => {
      tx.insert(experiments)
        .values({
          id,
          projectId,
          documentId: input.documentId,
          planId: input.planId,
          status: experiment.status,
          payload: experiment,
        })
        .run();
      tx.insert(experimentJobs)
        .values({
          id: randomUUID(),
          experimentId: id,
          status: 'pending',
          progress: experiment.progress,
        })
        .run();
    });
    return this.detail(id);
  }
  claim(id: string, owner: string): ExperimentDetail {
    this.database.db.transaction(() => {
      const experiment = this.get(id);
      this.plans.requireApproved(experiment.planId);
      if (experiment.status !== 'pending')
        throw new WorkflowError(
          'CLAIM_UNAVAILABLE',
          'This job is already owned or requires reconciliation.',
        );
      const active = this.list(experiment.projectId).some(
        (item) =>
          item.id !== id && ['claimed', 'interrupted'].includes(item.status),
      );
      if (active)
        throw new WorkflowError(
          'PROJECT_BUSY',
          'Another implementation is active or awaiting reconciliation in this project.',
        );
      const token = randomUUID();
      const expires = new Date(Date.now() + 300000).toISOString();
      this.save({
        ...experiment,
        status: 'claimed',
        claimOwner: owner,
        claimToken: token,
        claimExpiresAt: expires,
      });
      this.database.db
        .update(experimentJobs)
        .set({ status: 'claimed', owner, token, expiresAt: expires })
        .where(eq(experimentJobs.experimentId, id))
        .run();
    });
    return this.detail(id);
  }
  progress(
    id: string,
    token: string,
    message: string,
    ready: boolean,
  ): ExperimentDetail {
    const experiment = this.get(id);
    if (experiment.status !== 'claimed' || experiment.claimToken !== token)
      throw new WorkflowError(
        'INVALID_CLAIM',
        'Use the current implementation attempt ownership token.',
      );
    if (
      !experiment.claimExpiresAt ||
      Date.parse(experiment.claimExpiresAt) <= Date.now()
    ) {
      this.save({ ...experiment, status: 'interrupted', reconciliation: null });
      throw new WorkflowError(
        'RECONCILIATION_REQUIRED',
        'The claim expired. Inspect and reconcile before another attempt.',
      );
    }
    const expires = new Date(Date.now() + 300000).toISOString();
    this.save({
      ...experiment,
      progress: message,
      status: ready ? 'ready' : 'claimed',
      claimExpiresAt: expires,
    });
    this.database.db
      .update(experimentJobs)
      .set({
        status: ready ? 'completed' : 'claimed',
        progress: message,
        expiresAt: expires,
      })
      .where(eq(experimentJobs.experimentId, id))
      .run();
    return this.detail(id);
  }
  reconcile(id: string, evidence: string): ExperimentDetail {
    const experiment = this.get(id);
    if (
      this.active.size &&
      this.detail(id).runs.some((run) => this.active.has(run.id))
    )
      throw new WorkflowError(
        'RUN_ACTIVE',
        'Wait for the running evaluation to stop.',
      );
    if (
      experiment.status !== 'interrupted' &&
      !(
        experiment.status === 'claimed' &&
        Date.parse(experiment.claimExpiresAt ?? '') <= Date.now()
      )
    )
      throw new WorkflowError(
        'NOT_INTERRUPTED',
        'Only interrupted or expired attempts can be reconciled.',
      );
    this.save({
      ...experiment,
      status: 'pending',
      claimToken: null,
      claimOwner: null,
      claimExpiresAt: null,
      reconciliation: evidence,
    });
    this.database.db
      .update(experimentJobs)
      .set({
        status: 'pending',
        owner: null,
        token: null,
        expiresAt: null,
        progress: evidence,
      })
      .where(eq(experimentJobs.experimentId, id))
      .run();
    return this.detail(id);
  }
  startRun(id: string, role: 'baseline' | 'candidate'): EvaluationRun {
    const experiment = this.get(id);
    const plan = this.plans.requireApproved(experiment.planId);
    if (
      experiment.status === 'claimed' &&
      Date.parse(experiment.claimExpiresAt ?? '') <= Date.now()
    ) {
      this.save({ ...experiment, status: 'interrupted', reconciliation: null });
      throw new WorkflowError(
        'RECONCILIATION_REQUIRED',
        'The implementation claim expired; inspect and reconcile before executing.',
      );
    }
    if (experiment.status === 'interrupted')
      throw new WorkflowError(
        'RECONCILIATION_REQUIRED',
        'Reconcile the interrupted attempt before executing.',
      );
    if (
      role === 'candidate' &&
      !['ready', 'completed'].includes(experiment.status)
    )
      throw new WorkflowError(
        'IMPLEMENTATION_PENDING',
        'The owning agent must report the candidate ready before evaluation.',
      );
    if (this.detail(id).runs.some((run) => run.status === 'running'))
      throw new WorkflowError(
        'RUN_ACTIVE',
        'An evaluation is already running for this experiment.',
      );
    const workspace =
      role === 'baseline' ? experiment.baselinePath : experiment.candidatePath;
    const run: EvaluationRun = {
      id: randomUUID(),
      experimentId: id,
      planId: plan.id,
      role,
      status: 'running',
      producer: 'harness',
      producerIdentity: 'paperloop-local-harness',
      codeIdentity: codeIdentity(workspace),
      planFingerprint: plan.fingerprint,
      datasetIdentity: plan.configuration.datasetIdentity,
      environmentIdentity: plan.configuration.environmentIdentity,
      result: null,
      error: null,
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      artifactReferences: [],
    };
    this.database.db
      .insert(evaluationRuns)
      .values({
        id: run.id,
        experimentId: id,
        status: run.status,
        payload: run,
      })
      .run();
    let execution: Execution;
    try {
      execution = executePlan(
        plan,
        workspace,
        join(this.database.dataDirectory, 'runs', run.id),
      );
    } catch (failure) {
      const failed: EvaluationRun = {
        ...run,
        status: 'failed',
        error:
          failure instanceof Error
            ? failure.message
            : 'Could not launch evaluation.',
        finishedAt: new Date().toISOString(),
      };
      this.database.db
        .update(evaluationRuns)
        .set({ status: failed.status, payload: failed })
        .where(eq(evaluationRuns.id, run.id))
        .run();
      return failed;
    }
    this.active.set(run.id, execution);
    void execution.done.then((result) => {
      const { artifacts, ...evidence } = result;
      const completed: EvaluationRun = {
        ...run,
        ...evidence,
        artifactReferences: artifacts,
        finishedAt: new Date().toISOString(),
      };
      this.database.db
        .update(evaluationRuns)
        .set({ status: completed.status, payload: completed })
        .where(eq(evaluationRuns.id, run.id))
        .run();
      this.active.delete(run.id);
    });
    return run;
  }
  importResult(
    id: string,
    role: 'baseline' | 'candidate',
    producerIdentity: string,
    declaredCodeIdentity: string,
    input: EvaluationResult,
  ): EvaluationRun {
    const experiment = this.get(id);
    const plan = this.plans.requireApproved(experiment.planId);
    const result = evaluationResultSchema.parse(input);
    const run: EvaluationRun = {
      id: randomUUID(),
      experimentId: id,
      planId: plan.id,
      role,
      status: 'completed',
      producer: 'external',
      producerIdentity,
      codeIdentity: declaredCodeIdentity,
      planFingerprint: plan.fingerprint,
      datasetIdentity: plan.configuration.datasetIdentity,
      environmentIdentity: plan.configuration.environmentIdentity,
      result,
      error: null,
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      artifactReferences: [],
    };
    this.database.db
      .insert(evaluationRuns)
      .values({
        id: run.id,
        experimentId: id,
        status: run.status,
        payload: run,
      })
      .run();
    return run;
  }
  run(id: string): EvaluationRun {
    const row = this.database.db
      .select()
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, id))
      .get();
    if (!row)
      throw new WorkflowError(
        'RUN_NOT_FOUND',
        'Evaluation run was not found.',
        404,
      );
    return row.payload;
  }
  cancel(id: string): EvaluationRun {
    const run = this.run(id);
    const execution = this.active.get(id);
    if (!execution)
      throw new WorkflowError(
        'RUN_NOT_ACTIVE',
        'The run is no longer active; inspect its status.',
      );
    execution.cancel();
    return run;
  }
  artifact(id: string, name: string): string {
    const run = this.run(id);
    if (!run.artifactReferences.includes(name))
      throw new WorkflowError(
        'ARTIFACT_NOT_FOUND',
        'Only registered artifacts are available.',
        404,
      );
    return readFileSync(
      join(this.database.dataDirectory, 'runs', id, name),
      'utf8',
    ).slice(0, 100000);
  }
  compare(id: string, baselineId: string, candidateId: string): Comparison {
    const experiment = this.get(id);
    const plan = this.plans.requireApproved(experiment.planId);
    const baseline = this.run(baselineId);
    const candidate = this.run(candidateId);
    if (['claimed', 'interrupted'].includes(experiment.status))
      throw new WorkflowError(
        'IMPLEMENTATION_PENDING',
        'Finish or reconcile the implementation attempt before completing a comparison.',
      );
    const reasons: string[] = [];
    if (
      baseline.experimentId !== id ||
      candidate.experimentId !== id ||
      baseline.role !== 'baseline' ||
      candidate.role !== 'candidate'
    )
      throw new WorkflowError(
        'INVALID_COMPARISON',
        'Choose a baseline and candidate from this experiment.',
      );
    if (
      [baseline, candidate].some(
        (run) => run.status !== 'completed' || !run.result,
      )
    )
      reasons.push('Both runs require complete validated evidence.');
    if (
      [baseline, candidate].some(
        (run) =>
          run.planId !== plan.id ||
          run.planFingerprint !== plan.fingerprint ||
          run.datasetIdentity !== plan.configuration.datasetIdentity ||
          run.environmentIdentity !== plan.configuration.environmentIdentity,
      )
    )
      reasons.push(
        'Plan, dataset, or environment conditions are incompatible.',
      );
    if (baseline.producer !== candidate.producer)
      reasons.push(
        'Harness and externally reported evidence have different provenance.',
      );
    if (baseline.producerIdentity !== candidate.producerIdentity)
      reasons.push('Result producer identities are incompatible.');
    let improved = false;
    let regressed = false;
    const metrics = plan.configuration.metrics.map((criterion) => {
      const a = baseline.result?.metrics.find(
        (metric) => metric.name === criterion.name,
      );
      const b = candidate.result?.metrics.find(
        (metric) => metric.name === criterion.name,
      );
      const compatible =
        a && b && a.unit === criterion.unit && b.unit === criterion.unit;
      const enough =
        (a?.samples?.length ?? (a ? 1 : 0)) >= criterion.minimumSamples &&
        (b?.samples?.length ?? (b ? 1 : 0)) >= criterion.minimumSamples;
      if (!compatible || !enough)
        reasons.push(
          `Missing, incompatible, or insufficient samples for ${criterion.name}.`,
        );
      const delta = compatible ? b.value - a.value : null;
      const directed =
        delta === null
          ? null
          : delta * (criterion.direction === 'increase' ? 1 : -1);
      const passed =
        directed !== null && directed >= -criterion.maximumRegression;
      if (!passed) regressed = true;
      if (
        !criterion.guardrail &&
        directed !== null &&
        directed > 0 &&
        directed >= criterion.minimumImprovement
      )
        improved = true;
      return {
        name: criterion.name,
        unit: criterion.unit,
        baseline: a?.value ?? null,
        candidate: b?.value ?? null,
        delta,
        percentChange:
          compatible && a.value !== 0
            ? ((b.value - a.value) / Math.abs(a.value)) * 100
            : null,
        guardrail: criterion.guardrail,
        passed,
      };
    });
    const comparison: Comparison = {
      id: randomUUID(),
      experimentId: id,
      baselineRunId: baselineId,
      candidateRunId: candidateId,
      outcome: reasons.length
        ? 'inconclusive'
        : regressed
          ? 'regression'
          : improved
            ? 'improvement'
            : 'no_meaningful_change',
      reasons,
      metrics,
      createdAt: new Date().toISOString(),
    };
    this.database.db
      .insert(experimentComparisons)
      .values({ id: comparison.id, experimentId: id, payload: comparison })
      .run();
    if (comparison.outcome !== 'inconclusive')
      this.save({ ...experiment, status: 'completed' });
    return comparison;
  }
  async close(): Promise<void> {
    for (const execution of this.active.values()) execution.cancel();
    await Promise.allSettled(
      [...this.active.values()].map((execution) => execution.done),
    );
  }
  private save(experiment: Experiment): void {
    this.database.db
      .update(experiments)
      .set({ status: experiment.status, payload: experiment })
      .where(eq(experiments.id, experiment.id))
      .run();
  }
}
