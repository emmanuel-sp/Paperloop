import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type {
  EvaluationPlanDraft,
  Experiment,
  EvaluationRun,
  Comparison,
} from '@paperloop/contracts';

export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const evaluationPlans = sqliteTable(
  'evaluation_plans',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    configuration: text('configuration', { mode: 'json' })
      .$type<EvaluationPlanDraft>()
      .notNull(),
    fingerprint: text('fingerprint').notNull(),
    approvedAt: text('approved_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('evaluation_plan_version_unique').on(
      table.projectId,
      table.version,
    ),
  ],
);

export const experiments = sqliteTable('experiments', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  documentId: text('document_id')
    .notNull()
    .references(() => researchDocuments.id),
  planId: text('plan_id')
    .notNull()
    .references(() => evaluationPlans.id),
  status: text('status').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Experiment>().notNull(),
});
export const experimentJobs = sqliteTable('experiment_jobs', {
  id: text('id').primaryKey(),
  experimentId: text('experiment_id')
    .notNull()
    .references(() => experiments.id),
  status: text('status').notNull(),
  owner: text('owner'),
  token: text('token'),
  expiresAt: text('expires_at'),
  progress: text('progress').notNull(),
});
export const evaluationRuns = sqliteTable('evaluation_runs', {
  id: text('id').primaryKey(),
  experimentId: text('experiment_id')
    .notNull()
    .references(() => experiments.id),
  status: text('status').notNull(),
  payload: text('payload', { mode: 'json' }).$type<EvaluationRun>().notNull(),
});
export const experimentComparisons = sqliteTable('experiment_comparisons', {
  id: text('id').primaryKey(),
  experimentId: text('experiment_id')
    .notNull()
    .references(() => experiments.id),
  payload: text('payload', { mode: 'json' }).$type<Comparison>().notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  objectives: text('objectives', { mode: 'json' }).$type<string[]>().notNull(),
  constraints: text('constraints', { mode: 'json' })
    .$type<string[]>()
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const projectRepositories = sqliteTable(
  'project_repositories',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['local', 'github'] }).notNull(),
    localPath: text('local_path'),
    githubOwner: text('github_owner'),
    githubRepository: text('github_repository'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('project_repositories_project_id_unique').on(table.projectId),
  ],
);

export const projectContextSnapshots = sqliteTable(
  'project_context_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    summary: text('summary').notNull(),
    sourceKind: text('source_kind', {
      enum: ['description', 'local', 'github'],
    }).notNull(),
    sourceReference: text('source_reference'),
    repositoryRevision: text('repository_revision'),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('project_context_project_version_unique').on(
      table.projectId,
      table.version,
    ),
  ],
);

export const researchDocuments = sqliteTable(
  'research_documents',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    sourceKind: text('source_kind', {
      enum: ['url', 'arxiv', 'reference'],
    }).notNull(),
    sourceReference: text('source_reference').notNull(),
    canonicalUrl: text('canonical_url'),
    authors: text('authors', { mode: 'json' }).$type<string[]>().notNull(),
    sourceVersion: text('source_version'),
    extractionStatus: text('extraction_status', {
      enum: ['pending', 'partial', 'complete', 'unavailable', 'failed'],
    }).notNull(),
    extractedContentReference: text('extracted_content_reference'),
    extractionError: text('extraction_error'),
    retrievedAt: integer('retrieved_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('research_documents_source_identity_unique').on(
      table.sourceKind,
      table.sourceReference,
    ),
  ],
);

export const projectResearchDocuments = sqliteTable(
  'project_research_documents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => researchDocuments.id, { onDelete: 'cascade' }),
    submittedBy: text('submitted_by', { enum: ['user', 'agent'] }).notNull(),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('project_research_documents_membership_unique').on(
      table.projectId,
      table.documentId,
    ),
  ],
);

export const implementationBriefs = sqliteTable(
  'implementation_briefs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => researchDocuments.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    summary: text('summary').notNull(),
    applicability: text('applicability').notNull(),
    proposedChanges: text('proposed_changes', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    risks: text('risks', { mode: 'json' }).$type<string[]>().notNull(),
    evaluationIdeas: text('evaluation_ideas', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    sourceClaims: text('source_claims', { mode: 'json' })
      .$type<Array<{ claim: string; evidence: string }>>()
      .notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('implementation_briefs_project_document_version_unique').on(
      table.projectId,
      table.documentId,
      table.version,
    ),
  ],
);

export const researchVersions = sqliteTable('research_versions', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => researchDocuments.id, { onDelete: 'cascade' }),
  sourceVersion: text('source_version'),
  extractionStatus: text('extraction_status').notNull(),
  extractionError: text('extraction_error'),
  contentReference: text('content_reference'),
  retrievedAt: text('retrieved_at').notNull(),
});
export const projectSourceSelections = sqliteTable(
  'project_source_selections',
  {
    projectId: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    selection: text('selection', { mode: 'json' })
      .$type<import('@paperloop/contracts').SourceSelection>()
      .notNull(),
  },
);
export const discoveryScans = sqliteTable('discovery_scans', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  payload: text('payload', { mode: 'json' })
    .$type<import('@paperloop/contracts').DiscoveryScan>()
    .notNull(),
});
export const researchRecommendations = sqliteTable(
  'research_recommendations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => researchDocuments.id, { onDelete: 'cascade' }),
    payload: text('payload', { mode: 'json' })
      .$type<import('@paperloop/contracts').Recommendation>()
      .notNull(),
  },
  (table) => [
    uniqueIndex('recommendation_project_document_unique').on(
      table.projectId,
      table.documentId,
    ),
  ],
);
export const recommendationTriage = sqliteTable('recommendation_triage', {
  id: text('id').primaryKey(),
  recommendationId: text('recommendation_id')
    .notNull()
    .references(() => researchRecommendations.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  reason: text('reason').notNull(),
  experimentId: text('experiment_id'),
  createdAt: text('created_at').notNull(),
});

export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  payload: text('payload', { mode: 'json' })
    .$type<import('@paperloop/contracts').Schedule>()
    .notNull(),
});
export const scheduleJobs = sqliteTable(
  'schedule_jobs',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    occurrence: text('occurrence').notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<import('@paperloop/contracts').ScheduleJob>()
      .notNull(),
  },
  (table) => [
    uniqueIndex('schedule_occurrence_unique').on(
      table.scheduleId,
      table.revision,
      table.occurrence,
    ),
  ],
);
export const automationRules = sqliteTable('automation_rules', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  payload: text('payload', { mode: 'json' })
    .$type<import('@paperloop/contracts').AutomationRule>()
    .notNull(),
  approvedAt: text('approved_at').notNull(),
});
export const automationExperiments = sqliteTable(
  'automation_experiments',
  {
    experimentId: text('experiment_id')
      .primaryKey()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    recommendationId: text('recommendation_id')
      .notNull()
      .references(() => researchRecommendations.id),
    maxRuns: integer('max_runs').notNull(),
  },
  (table) => [
    uniqueIndex('automated_recommendation_unique').on(
      table.projectId,
      table.recommendationId,
    ),
  ],
);
export const apiActivations = sqliteTable(
  'api_activations',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<import('@paperloop/contracts').ApiActivation>()
      .notNull(),
  },
  (table) => [
    uniqueIndex('api_activation_unique').on(table.projectId, table.provider),
  ],
);
