import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import {
  evaluationPlanDraftSchema,
  type EvaluationSuggestion,
  type EvaluationPlanDraft,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import { appState, researchRecommendations } from '../storage/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import type { ResearchService } from '../research/research-service.js';
import { PlanService, fingerprint, WorkflowError } from './plan-service.js';
function readMetadata(root: string, name: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(
      join(root, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 32768) return null;
    const bytes = Buffer.alloc(32769);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    return count <= 32768 ? bytes.subarray(0, count).toString('utf8') : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export class EvaluationSuggestionService {
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
    private readonly research: ResearchService,
    private readonly plans: PlanService,
  ) {}
  suggest(
    projectId: string,
    documentId?: string,
    recommendationId?: string,
    researchAngle?: string,
  ): EvaluationSuggestion {
    const project = this.projects.get(projectId);
    const paper = documentId ? this.research.get(projectId, documentId) : null;
    const recommendation = recommendationId
      ? this.database.db
          .select()
          .from(researchRecommendations)
          .where(
            and(
              eq(researchRecommendations.id, recommendationId),
              eq(researchRecommendations.projectId, projectId),
            ),
          )
          .get()?.payload
      : null;
    if (
      recommendationId &&
      (!recommendation ||
        recommendation.documentId !== documentId ||
        recommendation.proposal.projectContextVersion !==
          project.currentContext.version)
    )
      throw new WorkflowError(
        'RESEARCH_CONTEXT_CHANGED',
        'The recommendation is unavailable or its project context changed. Return to research for reassessment.',
      );
    const rationale = [
      project.objectives.length
        ? `Project objectives: ${project.objectives.join('; ')}`
        : 'Use the project context to establish success criteria before implementation.',
    ];
    if (paper)
      rationale.push(
        `Research: ${paper.title}${paper.currentBrief ? ` — ${paper.currentBrief.applicability}` : ''}`,
      );
    if (recommendation)
      rationale.push(
        `Recommended targets: ${recommendation.proposal.evaluationTargets.join('; ')}`,
      );
    const angle =
      (researchAngle || project.currentContext.inference?.researchDirection) ??
      project.objectives[0] ??
      project.description.slice(0, 500);
    const context = {
      recommendationId: recommendationId ?? null,
      documentId: paper?.id ?? null,
      documentTitle: paper?.title ?? null,
      sourceVersion: paper?.sourceVersion ?? null,
      contextVersion: project.currentContext.version,
      researchAngle: angle,
    };
    let draft: EvaluationPlanDraft | null = null;
    const limitations: string[] = [];
    const root =
      project.repository?.kind === 'local' ? project.repository.path : null;
    if (root) {
      const manifest = readMetadata(root, 'paperloop.evaluation.json');
      if (manifest) {
        try {
          draft = evaluationPlanDraftSchema.parse(JSON.parse(manifest));
          rationale.push(
            'Suggested from the repository’s paperloop.evaluation.json measurement contract.',
          );
        } catch {
          limitations.push(
            'The repository Evaluation contract is invalid. Ask your coding agent to correct paperloop.evaluation.json.',
          );
        }
      }
    }
    const current = this.plans.list(projectId);
    const reusable = draft
      ? current.find((plan) => plan.fingerprint === fingerprint(draft))
      : current[0];
    if (reusable) {
      rationale.push(
        'Reuse the current project Evaluation; confirm its dataset and metrics are relevant to this research.',
      );
      limitations.push(
        'An existing configuration does not establish research applicability or a measured improvement.',
      );
      return {
        ...context,
        plan: reusable,
        draft: null,
        rationale,
        limitations,
      };
    }
    if (!draft && root) {
      try {
        const pkg = JSON.parse(readMetadata(root, 'package.json') ?? '{}') as {
          scripts?: Record<string, unknown>;
        };
        if (typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim()) {
          draft = evaluationPlanDraftSchema.parse({
            name: 'Repository test guardrail',
            datasetIdentity:
              'Repository test suite (package.json scripts.test)',
            cases: [
              'Run the existing repository test command once in each isolated workspace.',
            ],
            environmentIdentity:
              'Local Node.js and npm; repository dependencies must be available',
            metrics: [
              {
                name: 'test_passed',
                unit: 'boolean (0 or 1)',
                direction: 'increase',
                minimumImprovement: 0,
                maximumRegression: 0,
                minimumSamples: 1,
                guardrail: true,
              },
            ],
            command: {
              executable: process.execPath,
              arguments: [
                fileURLToPath(new URL('./test-adapter.js', import.meta.url)),
                'result.json',
                'npm',
                'test',
              ],
              workingDirectory: '.',
              resultPath: 'result.json',
              timeoutMs: 60000,
              environmentReferences: [],
            },
          });
          rationale.push(
            'Detected package.json scripts.test. A local adapter records the actual test-command exit outcome.',
          );
          limitations.push(
            'This is a regression guardrail, not a research-quality benchmark. Add a dataset and quality metrics with your coding agent before claiming an improvement. One run supplies one observation; dependencies must already be installed.',
          );
        }
      } catch {
        limitations.push(
          'Repository test metadata could not be interpreted safely.',
        );
      }
    }
    if (!draft) {
      const capabilities =
        project.currentContext.inference?.evaluationCapabilities ?? [];
      limitations.push(
        capabilities.length
          ? `Observed capabilities: ${capabilities.map((item) => item.name).join(', ')}. They do not yet provide a validated metric/result contract.`
          : 'No reusable Evaluation or supported repository measurement contract is available.',
      );
      limitations.push(
        'Ask your coding agent to draft an Evaluation via evaluations_draft or add paperloop.evaluation.json; custom setup remains available. No model call is required.',
      );
    }
    return { ...context, plan: null, draft, rationale, limitations };
  }
  use(
    projectId: string,
    documentId: string | undefined,
    expectedContext: number,
    recommendationId?: string,
    researchAngle?: string,
  ) {
    const suggestion = this.suggest(
      projectId,
      documentId,
      recommendationId,
      researchAngle,
    );
    if (suggestion.contextVersion !== expectedContext)
      throw new WorkflowError(
        'CONTEXT_CHANGED',
        'Project context changed. Review the refreshed suggestion.',
      );
    if (!suggestion.plan && !suggestion.draft)
      throw new WorkflowError(
        'EVALUATION_EVIDENCE_MISSING',
        'Ask your coding agent to supply an Evaluation measurement contract.',
      );
    const plan =
      suggestion.plan ?? this.plans.draft(projectId, suggestion.draft!);
    const key = `evaluation-context:${projectId}:${documentId ?? 'project'}:${plan.id}`;
    const value = JSON.stringify({
      ...suggestion,
      draft: null,
      planId: plan.id,
    });
    this.database.db
      .insert(appState)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value, updatedAt: new Date() },
      })
      .run();
    return plan;
  }
}
