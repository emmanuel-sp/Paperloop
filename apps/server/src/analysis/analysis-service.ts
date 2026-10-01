import { and, eq } from 'drizzle-orm';
import {
  apiActivationSchema,
  analysisOutputSchema,
  type ApiActivation,
  type AnalysisOutput,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import {
  apiActivations,
  researchRecommendations,
  researchVersions,
} from '../storage/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import type { ResearchService } from '../research/research-service.js';
import type { DiscoveryService } from '../research/discovery-service.js';
import type { PlanService } from '../evaluations/plan-service.js';
import { WorkflowError } from '../evaluations/plan-service.js';
import {
  createModelExecutor,
  type ModelExecutor,
  type ModelProvider,
} from './providers.js';
export class AnalysisService {
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
    private readonly research: ResearchService,
    private readonly discovery: DiscoveryService,
    private readonly plans: PlanService,
    private readonly execute: ModelExecutor = createModelExecutor(),
  ) {}
  settings(projectId: string) {
    this.projects.get(projectId);
    return this.database.db
      .select()
      .from(apiActivations)
      .where(eq(apiActivations.projectId, projectId))
      .all()
      .map((row) => row.payload);
  }
  activate(projectId: string, input: ApiActivation) {
    this.projects.get(projectId);
    input = apiActivationSchema.parse(input);
    this.database.db
      .insert(apiActivations)
      .values({ projectId, provider: input.provider, payload: input })
      .onConflictDoUpdate({
        target: [apiActivations.projectId, apiActivations.provider],
        set: { payload: input },
      })
      .run();
    return input;
  }
  requireEnabled(projectId: string, provider: ModelProvider) {
    const input = this.database.db
      .select()
      .from(apiActivations)
      .where(
        and(
          eq(apiActivations.projectId, projectId),
          eq(apiActivations.provider, provider),
        ),
      )
      .get()?.payload;
    if (!input?.enabled)
      throw new WorkflowError(
        'API_ANALYSIS_DISABLED',
        'Enable this provider in the workbench before starting paid analysis.',
      );
    return input;
  }
  pending(projectId: string, documentIds: string[]) {
    const contextVersion = this.projects.get(projectId).currentContext.version;
    return [...new Set(documentIds)]
      .filter((id) => {
        const recommendation = this.database.db
          .select()
          .from(researchRecommendations)
          .where(
            and(
              eq(researchRecommendations.projectId, projectId),
              eq(researchRecommendations.documentId, id),
            ),
          )
          .get()?.payload;
        if (!recommendation) return true;
        if (['dismissed', 'tested'].includes(recommendation.state))
          return false;
        if (recommendation.proposal.projectContextVersion !== contextVersion)
          return true;
        return recommendation.proposal.sources.some((source) => {
          const document = this.research.get(projectId, source.documentId);
          if (document.sourceVersion !== (source.sourceVersion ?? null))
            return true;
          const versions = this.database.db
            .select()
            .from(researchVersions)
            .where(eq(researchVersions.documentId, source.documentId))
            .all();
          return versions.some(
            (version) =>
              version.sourceVersion === document.sourceVersion &&
              Date.parse(version.retrievedAt) >
                Date.parse(recommendation.updatedAt),
          );
        });
      })
      .slice(0, 25);
  }
  context(projectId: string, documentIds: string[]) {
    const project = this.projects.get(projectId);
    return {
      project: {
        name: project.name,
        objectives: project.objectives,
        constraints: project.constraints,
        context: {
          version: project.currentContext.version,
          summary: project.currentContext.summary,
        },
      },
      documents: documentIds.slice(0, 25).map((id) => {
        const document = this.research.get(projectId, id);
        return {
          documentId: id,
          title: document.title,
          sourceReference: document.sourceReference,
          sourceVersion: document.sourceVersion,
          extractionStatus: document.extractionStatus,
          content: this.research.readContent(projectId, id, {
            offset: 0,
            limit: 10000,
          }).content,
        };
      }),
    };
  }
  apply(projectId: string, documentIds: string[], input: AnalysisOutput) {
    const output = analysisOutputSchema.parse(input);
    if (
      new Set(output.recommendations.map((value) => value.documentId)).size !==
      output.recommendations.length
    )
      throw new WorkflowError(
        'DUPLICATE_OUTPUT',
        'Submit each primary document once.',
      );
    for (const proposal of output.recommendations) {
      if (
        !documentIds.includes(proposal.documentId) ||
        proposal.sources.some(
          (source) => !documentIds.includes(source.documentId),
        )
      )
        throw new WorkflowError(
          'INVALID_ANALYSIS_DOCUMENT',
          'Analysis must reference only documents assigned to this job.',
        );
    }
    // Services validate provenance/context. Roll back the entire batch on failure.
    this.database.db.transaction(() => {
      for (const proposal of output.recommendations)
        this.discovery.storeRecommendation(projectId, proposal);
      for (const plan of output.plans) this.plans.draft(projectId, plan);
    });
    return output;
  }
  async analyze(
    projectId: string,
    provider: ModelProvider,
    documentIds: string[],
    signal: AbortSignal,
  ) {
    const activation = this.requireEnabled(projectId, provider);
    return this.execute({
      provider,
      model: activation.model,
      context: this.context(projectId, documentIds),
      signal,
    });
  }
}
