import { z } from 'zod';
import { githubRepositoryIdentitySchema } from './github.js';
export * from './evaluations.js';
export * from './github.js';

export const healthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

const nonEmptyText = z.string().trim().min(1);

export const projectRepositorySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local'),
      path: nonEmptyText,
    })
    .strict(),
  z
    .object({
      kind: z.literal('github'),
      owner: githubRepositoryIdentitySchema.shape.owner,
      repository: githubRepositoryIdentitySchema.shape.repository,
    })
    .strict(),
]);
export type ProjectRepository = z.infer<typeof projectRepositorySchema>;

export const createProjectRequestSchema = z.object({
  name: nonEmptyText.max(120),
  description: nonEmptyText.max(10_000),
  objectives: z.array(nonEmptyText.max(500)).max(50).default([]),
  constraints: z.array(nonEmptyText.max(500)).max(50).default([]),
  repository: projectRepositorySchema.optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = createProjectRequestSchema
  .omit({ repository: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one project field is required.',
  });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const refreshProjectContextRequestSchema = z.object({
  summary: nonEmptyText.max(20_000).optional(),
  repositoryRevision: nonEmptyText.max(200).optional(),
});
export type RefreshProjectContextRequest = z.infer<
  typeof refreshProjectContextRequestSchema
>;

export const projectContextSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  summary: z.string(),
  sourceKind: z.enum(['description', 'local', 'github']),
  sourceReference: z.string().nullable(),
  repositoryRevision: z.string().nullable(),
  capturedAt: z.iso.datetime(),
});
export type ProjectContext = z.infer<typeof projectContextSchema>;

export const projectContextListResponseSchema = z.object({
  contexts: z.array(projectContextSchema),
});
export type ProjectContextListResponse = z.infer<
  typeof projectContextListResponseSchema
>;

export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  objectives: z.array(z.string()),
  constraints: z.array(z.string()),
  repository: projectRepositorySchema.nullable(),
  currentContext: projectContextSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema),
});
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const researchSourceKindSchema = z.enum(['url', 'arxiv', 'reference']);
export type ResearchSourceKind = z.infer<typeof researchSourceKindSchema>;

export const extractionStatusSchema = z.enum([
  'pending',
  'partial',
  'complete',
  'unavailable',
  'failed',
]);
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;

export const ingestResearchDocumentRequestSchema = z
  .object({
    title: nonEmptyText.max(500),
    sourceKind: researchSourceKindSchema,
    sourceReference: nonEmptyText.max(2_048),
    canonicalUrl: z.url().max(2_048).optional(),
    authors: z.array(nonEmptyText.max(200)).max(100).default([]),
    sourceVersion: nonEmptyText.max(200).optional(),
    extractionStatus: extractionStatusSchema.default('pending'),
    extractedContent: z.string().trim().min(1).max(5_000_000).optional(),
    extractionError: nonEmptyText.max(2_000).optional(),
    submittedBy: z.enum(['user', 'agent']).default('user'),
    retrievedAt: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    if (value.sourceKind === 'url') {
      try {
        new URL(value.sourceReference);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'A valid URL is required when the source kind is URL.',
          path: ['sourceReference'],
        });
      }
    }
    if (
      (value.extractionStatus === 'partial' ||
        value.extractionStatus === 'complete') &&
      !value.extractedContent
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Extracted content is required for partial or complete extraction.',
        path: ['extractedContent'],
      });
    }
    if (value.extractionStatus === 'failed' && !value.extractionError) {
      context.addIssue({
        code: 'custom',
        message: 'An extraction error is required when extraction failed.',
        path: ['extractionError'],
      });
    }
  });
export type IngestResearchDocumentRequest = z.infer<
  typeof ingestResearchDocumentRequestSchema
>;

export const implementationClaimSchema = z.object({
  claim: nonEmptyText.max(2_000),
  evidence: nonEmptyText.max(2_000),
});
export type ImplementationClaim = z.infer<typeof implementationClaimSchema>;

export const storeImplementationBriefRequestSchema = z.object({
  summary: nonEmptyText.max(20_000),
  applicability: nonEmptyText.max(20_000),
  proposedChanges: z.array(nonEmptyText.max(2_000)).max(100).default([]),
  risks: z.array(nonEmptyText.max(2_000)).max(100).default([]),
  evaluationIdeas: z.array(nonEmptyText.max(2_000)).max(100).default([]),
  sourceClaims: z.array(implementationClaimSchema).max(100).default([]),
});
export type StoreImplementationBriefRequest = z.infer<
  typeof storeImplementationBriefRequestSchema
>;

export const implementationBriefSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  documentId: z.uuid(),
  version: z.number().int().positive(),
  summary: z.string(),
  applicability: z.string(),
  proposedChanges: z.array(z.string()),
  risks: z.array(z.string()),
  evaluationIdeas: z.array(z.string()),
  sourceClaims: z.array(implementationClaimSchema),
  createdAt: z.iso.datetime(),
});
export type ImplementationBrief = z.infer<typeof implementationBriefSchema>;

export const researchDocumentSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  sourceKind: researchSourceKindSchema,
  sourceReference: z.string(),
  canonicalUrl: z.string().nullable(),
  authors: z.array(z.string()),
  sourceVersion: z.string().nullable(),
  extractionStatus: extractionStatusSchema,
  extractedContentAvailable: z.boolean(),
  extractionError: z.string().nullable(),
  submittedBy: z.enum(['user', 'agent']),
  retrievedAt: z.iso.datetime().nullable(),
  currentBrief: implementationBriefSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ResearchDocument = z.infer<typeof researchDocumentSchema>;

export const researchDocumentListResponseSchema = z.object({
  documents: z.array(researchDocumentSchema),
});
export type ResearchDocumentListResponse = z.infer<
  typeof researchDocumentListResponseSchema
>;

export const readResearchContentRequestSchema = z.object({
  versionId: z.uuid().optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(20_000).default(10_000),
});
export type ReadResearchContentRequest = z.infer<
  typeof readResearchContentRequestSchema
>;

export const researchContentPageSchema = z.object({
  documentId: z.uuid(),
  content: z.string(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().positive().nullable(),
  totalLength: z.number().int().nonnegative(),
});
export type ResearchContentPage = z.infer<typeof researchContentPageSchema>;

export * from './discovery.js';

export * from './schedules.js';
