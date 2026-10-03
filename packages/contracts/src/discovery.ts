import { z } from 'zod';

const text = z.string().trim().min(1);
export const publicUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, 'Use an HTTP(S) URL without credentials.');
export const sourceSchema = z.object({
  id: text.max(100),
  name: text.max(200),
  kind: z.enum(['arxiv', 'feed']),
  url: publicUrlSchema.optional(),
  query: text.max(500).optional(),
  coverage: text,
});
export type ResearchSource = z.infer<typeof sourceSchema>;
export const collectionSchema = z.object({
  id: text,
  name: text,
  description: text,
  sourceIds: z.array(text),
});
export const sourceCatalogSchema = z.object({
  sources: z.array(sourceSchema),
  collections: z.array(collectionSchema),
});
export const sourceSelectionSchema = z
  .object({
    collectionIds: z.array(text.max(100)).max(30).default([]),
    sourceIds: z.array(text.max(100)).max(30).default([]),
    excludedSourceIds: z.array(text.max(100)).max(30).default([]),
    feeds: z
      .array(z.object({ url: publicUrlSchema, name: text.max(200) }).strict())
      .max(20)
      .default([]),
  })
  .strict();
export type SourceSelection = z.infer<typeof sourceSelectionSchema>;
export const projectSourcesSchema = z.object({
  selection: sourceSelectionSchema,
  sources: z.array(sourceSchema),
  selectionOrigin: z.enum(['suggested', 'saved']).optional(),
});
export const discoverySearchRequestSchema = z
  .object({
    query: z.string().trim().max(500).default(''),
    useSuggestedSources: z.boolean().optional(),
    limit: z.number().int().min(1).max(25).default(10),
    offsets: z
      .record(z.string(), z.number().int().min(0).max(10000))
      .default({}),
  })
  .strict();
export type DiscoverySearchRequest = z.infer<
  typeof discoverySearchRequestSchema
>;
export const sourceOutcomeSchema = z.object({
  sourceId: text,
  status: z.enum(['ok', 'failed', 'rate_limited']),
  coverage: text,
  count: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  retryAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
});
export const discoveryScanSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  query: z.string(),
  createdAt: z.iso.datetime(),
  documentIds: z.array(z.uuid()),
  outcomes: z.array(sourceOutcomeSchema),
  analysisStatus: z.enum(['waiting_for_agent', 'complete']),
});
export type DiscoveryScan = z.infer<typeof discoveryScanSchema>;
export const discoveryScanListSchema = z.object({
  scans: z.array(discoveryScanSchema),
});
export const librarySearchRequestSchema = z.object({
  query: z.string().trim().max(500).default(''),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type LibrarySearchRequest = z.infer<typeof librarySearchRequestSchema>;
export const recommendationQuerySchema = librarySearchRequestSchema.extend({
  view: z.enum(['all', 'actionable', 'history']).default('all'),
});
export const libraryDocumentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  sourceKind: z.enum(['url', 'arxiv', 'reference']),
  sourceReference: z.string(),
  sourceVersion: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  authors: z.array(z.string()),
  extractionStatus: z.enum([
    'pending',
    'partial',
    'complete',
    'unavailable',
    'failed',
  ]),
});
export const librarySearchResponseSchema = z.object({
  documents: z.array(libraryDocumentSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export const documentVersionSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  sourceVersion: z.string().nullable(),
  extractionStatus: z.enum([
    'pending',
    'partial',
    'complete',
    'unavailable',
    'failed',
  ]),
  extractionError: z.string().nullable(),
  retrievedAt: z.iso.datetime(),
  contentAvailable: z.boolean(),
});
export const documentVersionListSchema = z.object({
  versions: z.array(documentVersionSchema),
});
export const fetchDocumentRequestSchema = z
  .object({ url: publicUrlSchema })
  .strict();
export const recommendationStateSchema = z.enum([
  'new',
  'saved',
  'dismissed',
  'tested',
]);
export const storeRecommendationRequestSchema = z
  .object({
    documentId: z.uuid(),
    title: text.max(500),
    summary: text.max(20000),
    applicability: text.max(20000),
    prerequisites: z.array(text.max(2000)).max(50),
    uncertainty: text.max(10000),
    evaluationTargets: z.array(text.max(2000)).min(1).max(50),
    sources: z
      .array(
        z
          .object({
            documentId: z.uuid(),
            sourceVersion: text.max(200).nullable().optional(),
            claim: text.max(2000),
            evidence: text.max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    projectContextVersion: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.sources.some((source) => source.documentId === value.documentId),
    'Include evidence from the primary document.',
  );
export type StoreRecommendationRequest = z.infer<
  typeof storeRecommendationRequestSchema
>;
export const triageRecommendationRequestSchema = z
  .object({
    state: recommendationStateSchema,
    reason: z.string().trim().max(2000).default(''),
    experimentId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (value) => value.state === 'tested' || !value.experimentId,
    'Experiment evidence applies only to tested recommendations.',
  );
export type TriageRecommendationRequest = z.infer<
  typeof triageRecommendationRequestSchema
>;
export const recommendationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  documentId: z.uuid(),
  proposal: storeRecommendationRequestSchema,
  revision: z.number().int().positive(),
  state: recommendationStateSchema,
  reason: z.string(),
  experimentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  relevance: z.object({
    contextCurrent: z.boolean(),
    matchedTerms: z.array(z.string()),
  }).optional(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;
export const recommendationListSchema = z.object({
  recommendations: z.array(recommendationSchema),
});
export const triageHistorySchema = z.object({
  history: z.array(
    z.object({
      state: recommendationStateSchema,
      reason: z.string(),
      experimentId: z.uuid().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
