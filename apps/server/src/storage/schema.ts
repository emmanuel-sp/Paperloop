import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  objectives: text('objectives', { mode: 'json' }).$type<string[]>().notNull(),
  constraints: text('constraints', { mode: 'json' }).$type<string[]>().notNull(),
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
