import {
  ingestResearchDocumentRequestSchema,
  researchImportInputSchema,
  researchImportPreviewSchema,
  researchImportCommitSchema,
  readResearchContentRequestSchema,
  researchContentPageSchema,
  researchDocumentListResponseSchema,
  researchDocumentSchema,
  storeImplementationBriefRequestSchema,
} from '@paperloop/contracts';
import type { FastifyInstance } from 'fastify';
import type { ResearchImportService } from './import-service.js';
import type { ResearchService } from './research-service.js';

interface ProjectParameters {
  id: string;
}

interface DocumentParameters extends ProjectParameters {
  documentId: string;
}

export function registerResearchRoutes(
  app: FastifyInstance,
  research: ResearchService,
  imports: ResearchImportService,
): void {
  app.post<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id/research/import/preview',
    { bodyLimit: 2 * 1024 * 1024 },
    async (request) =>
      researchImportPreviewSchema.parse(
        await imports.preview(
          request.params.id,
          researchImportInputSchema.parse(request.body),
        ),
      ),
  );
  app.post<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id/research/import/commit',
    async (request, reply) =>
      reply
        .code(201)
        .send(
          researchDocumentSchema.parse(
            imports.commit(
              request.params.id,
              researchImportCommitSchema.parse(request.body),
            ),
          ),
        ),
  );

  app.get<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id/research',
    async (request) =>
      researchDocumentListResponseSchema.parse({
        documents: research.list(request.params.id),
      }),
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/v1/projects/:id/research',
    async (request, reply) => {
      const document = research.ingest(
        request.params.id,
        ingestResearchDocumentRequestSchema.parse(request.body),
      );
      return reply.code(201).send(researchDocumentSchema.parse(document));
    },
  );

  app.get<{ Params: DocumentParameters }>(
    '/api/v1/projects/:id/research/:documentId',
    async (request) =>
      researchDocumentSchema.parse(
        research.get(request.params.id, request.params.documentId),
      ),
  );

  app.get<{ Params: DocumentParameters }>(
    '/api/v1/projects/:id/research/:documentId/content',
    async (request) =>
      researchContentPageSchema.parse(
        research.readContent(
          request.params.id,
          request.params.documentId,
          readResearchContentRequestSchema.parse(request.query),
        ),
      ),
  );

  app.post<{ Params: DocumentParameters }>(
    '/api/v1/projects/:id/research/:documentId/briefs',
    async (request, reply) => {
      const document = research.storeBrief(
        request.params.id,
        request.params.documentId,
        storeImplementationBriefRequestSchema.parse(request.body),
      );
      return reply.code(201).send(researchDocumentSchema.parse(document));
    },
  );
}
