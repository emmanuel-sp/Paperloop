import type { FastifyInstance } from 'fastify';
import {
  sourceCatalogSchema,
  sourceSelectionSchema,
  projectSourcesSchema,
  discoverySearchRequestSchema,
  discoveryScanSchema,
  discoveryScanListSchema,
  librarySearchRequestSchema,
  librarySearchResponseSchema,
  documentVersionListSchema,
  fetchDocumentRequestSchema,
  researchDocumentSchema,
  storeRecommendationRequestSchema,
  recommendationSchema,
  recommendationListSchema,
  triageRecommendationRequestSchema,
  triageHistorySchema,
  researchDocumentListResponseSchema,
} from '@paperloop/contracts';
import type { DiscoveryService } from './discovery-service.js';
import type { ResearchService } from './research-service.js';

interface ProjectParams {
  id: string;
}
interface DocumentParams extends ProjectParams {
  documentId: string;
}
interface RecommendationParams extends ProjectParams {
  recommendationId: string;
}
export function registerDiscoveryRoutes(
  app: FastifyInstance,
  discovery: DiscoveryService,
  research: ResearchService,
) {
  app.get('/api/v1/research/sources', async () =>
    sourceCatalogSchema.parse(discovery.catalog()),
  );
  app.get('/api/v1/research/library', async (request) =>
    librarySearchResponseSchema.parse(
      research.searchLibrary(librarySearchRequestSchema.parse(request.query)),
    ),
  );
  app.get<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/sources',
    async (request) =>
      projectSourcesSchema.parse(discovery.sources(request.params.id)),
  );
  app.put<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/sources',
    async (request) =>
      projectSourcesSchema.parse(
        discovery.selectSources(
          request.params.id,
          sourceSelectionSchema.parse(request.body),
        ),
      ),
  );
  app.post<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/discovery/search',
    async (request) =>
      discoveryScanSchema.parse(
        await discovery.search(
          request.params.id,
          discoverySearchRequestSchema.parse(request.body),
        ),
      ),
  );
  app.get<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/discovery/scans',
    async (request) =>
      discoveryScanListSchema.parse({
        scans: discovery.scans(request.params.id),
      }),
  );
  app.get<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/research/search',
    async (request) =>
      librarySearchResponseSchema.parse(
        research.searchLibrary(
          librarySearchRequestSchema.parse(request.query),
          request.params.id,
        ),
      ),
  );
  app.get<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/research/pending-analysis',
    async (request) =>
      researchDocumentListResponseSchema.parse({
        documents: discovery.pendingAnalysis(
          request.params.id,
          librarySearchRequestSchema.parse(request.query),
        ),
      }),
  );
  app.post<{ Params: DocumentParams }>(
    '/api/v1/projects/:id/research/:documentId/attach',
    async (request) =>
      researchDocumentSchema.parse(
        research.attach(request.params.id, request.params.documentId),
      ),
  );
  app.get<{ Params: DocumentParams }>(
    '/api/v1/projects/:id/research/:documentId/versions',
    async (request) =>
      documentVersionListSchema.parse({
        versions: research.versions(
          request.params.id,
          request.params.documentId,
        ),
      }),
  );
  app.post<{ Params: DocumentParams }>(
    '/api/v1/projects/:id/research/:documentId/extract',
    async (request) =>
      researchDocumentSchema.parse(
        await discovery.fetchDocument(
          request.params.id,
          request.params.documentId,
        ),
      ),
  );
  app.post<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/research/fetch',
    async (request) =>
      researchDocumentSchema.parse(
        await discovery.fetchUrl(
          request.params.id,
          fetchDocumentRequestSchema.parse(request.body).url,
        ),
      ),
  );
  app.get<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/recommendations',
    async (request) => {
      const { offset, limit } = librarySearchRequestSchema.parse(request.query);
      return recommendationListSchema.parse({
        recommendations: discovery.recommendations(
          request.params.id,
          offset,
          limit,
        ),
      });
    },
  );
  app.post<{ Params: ProjectParams }>(
    '/api/v1/projects/:id/recommendations',
    async (request) =>
      recommendationSchema.parse(
        discovery.storeRecommendation(
          request.params.id,
          storeRecommendationRequestSchema.parse(request.body),
        ),
      ),
  );
  app.patch<{ Params: RecommendationParams }>(
    '/api/v1/projects/:id/recommendations/:recommendationId',
    async (request) =>
      recommendationSchema.parse(
        discovery.triage(
          request.params.id,
          request.params.recommendationId,
          triageRecommendationRequestSchema.parse(request.body),
        ),
      ),
  );
  app.get<{ Params: RecommendationParams }>(
    '/api/v1/projects/:id/recommendations/:recommendationId/history',
    async (request) =>
      triageHistorySchema.parse({
        history: discovery.triageHistory(
          request.params.id,
          request.params.recommendationId,
        ),
      }),
  );
}
