import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ImplementationBrief,
  IngestResearchDocumentRequest,
  ReadResearchContentRequest,
  ResearchContentPage,
  ResearchDocument,
  StoreImplementationBriefRequest,
} from '@paperloop/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { ProjectService } from '../projects/project-service.js';
import type { PaperloopDatabase } from '../storage/database.js';
import {
  implementationBriefs,
  projectResearchDocuments,
  researchDocuments,
} from '../storage/schema.js';

export class ResearchDocumentNotFoundError extends Error {
  constructor(public readonly documentId: string) {
    super(`Research document ${documentId} was not found in this project.`);
    this.name = 'ResearchDocumentNotFoundError';
  }
}

export class ResearchService {
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
  ) {}

  ingest(
    projectId: string,
    input: IngestResearchDocumentRequest,
  ): ResearchDocument {
    this.projects.get(projectId);
    const now = new Date();
    const sourceReference = normalizeReference(
      input.sourceKind,
      input.sourceReference,
    );
    const existing = this.database.db
      .select()
      .from(researchDocuments)
      .where(
        and(
          eq(researchDocuments.sourceKind, input.sourceKind),
          eq(researchDocuments.sourceReference, sourceReference),
        ),
      )
      .get();
    const documentId = existing?.id ?? randomUUID();
    const extractedContentReference = input.extractedContent
      ? this.writeExtractedContent(documentId, input.extractedContent)
      : existing?.extractedContentReference ?? null;

    this.database.db.transaction((transaction) => {
      if (existing) {
        transaction
          .update(researchDocuments)
          .set({
            title: input.title,
            canonicalUrl: input.canonicalUrl ?? existing.canonicalUrl,
            authors: input.authors,
            sourceVersion: input.sourceVersion ?? existing.sourceVersion,
            extractionStatus: input.extractionStatus,
            extractedContentReference,
            extractionError: input.extractionError ?? null,
            retrievedAt: input.retrievedAt
              ? new Date(input.retrievedAt)
              : existing.retrievedAt,
            updatedAt: now,
          })
          .where(eq(researchDocuments.id, documentId))
          .run();
      } else {
        transaction
          .insert(researchDocuments)
          .values({
            id: documentId,
            title: input.title,
            sourceKind: input.sourceKind,
            sourceReference,
            canonicalUrl: input.canonicalUrl ?? null,
            authors: input.authors,
            sourceVersion: input.sourceVersion ?? null,
            extractionStatus: input.extractionStatus,
            extractedContentReference,
            extractionError: input.extractionError ?? null,
            retrievedAt: input.retrievedAt ? new Date(input.retrievedAt) : null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      transaction
        .insert(projectResearchDocuments)
        .values({
          id: randomUUID(),
          projectId,
          documentId,
          submittedBy: input.submittedBy,
          addedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            projectResearchDocuments.projectId,
            projectResearchDocuments.documentId,
          ],
          set: { submittedBy: input.submittedBy },
        })
        .run();
    });

    return this.get(projectId, documentId);
  }

  list(projectId: string): ResearchDocument[] {
    this.projects.get(projectId);
    return this.database.db
      .select({
        document: researchDocuments,
        membership: projectResearchDocuments,
      })
      .from(projectResearchDocuments)
      .innerJoin(
        researchDocuments,
        eq(projectResearchDocuments.documentId, researchDocuments.id),
      )
      .where(eq(projectResearchDocuments.projectId, projectId))
      .orderBy(desc(projectResearchDocuments.addedAt))
      .all()
      .map(({ document, membership }) =>
        this.hydrate(projectId, document, membership),
      );
  }

  get(projectId: string, documentId: string): ResearchDocument {
    this.projects.get(projectId);
    const row = this.database.db
      .select({
        document: researchDocuments,
        membership: projectResearchDocuments,
      })
      .from(projectResearchDocuments)
      .innerJoin(
        researchDocuments,
        eq(projectResearchDocuments.documentId, researchDocuments.id),
      )
      .where(
        and(
          eq(projectResearchDocuments.projectId, projectId),
          eq(projectResearchDocuments.documentId, documentId),
        ),
      )
      .get();
    if (!row) throw new ResearchDocumentNotFoundError(documentId);
    return this.hydrate(projectId, row.document, row.membership);
  }

  storeBrief(
    projectId: string,
    documentId: string,
    input: StoreImplementationBriefRequest,
  ): ResearchDocument {
    this.get(projectId, documentId);
    const current = this.currentBrief(projectId, documentId);

    this.database.db
      .insert(implementationBriefs)
      .values({
        id: randomUUID(),
        projectId,
        documentId,
        version: (current?.version ?? 0) + 1,
        summary: input.summary,
        applicability: input.applicability,
        proposedChanges: input.proposedChanges,
        risks: input.risks,
        evaluationIdeas: input.evaluationIdeas,
        sourceClaims: input.sourceClaims,
        createdAt: new Date(),
      })
      .run();

    return this.get(projectId, documentId);
  }

  readContent(
    projectId: string,
    documentId: string,
    input: ReadResearchContentRequest,
  ): ResearchContentPage {
    const document = this.get(projectId, documentId);
    const row = this.database.db
      .select({ reference: researchDocuments.extractedContentReference })
      .from(researchDocuments)
      .where(eq(researchDocuments.id, document.id))
      .get();
    const content = row?.reference
      ? this.readExtractedContent(row.reference)
      : '';
    const page = content.slice(input.offset, input.offset + input.limit);
    const nextOffset = input.offset + page.length;
    return {
      documentId,
      content: page,
      offset: input.offset,
      nextOffset: nextOffset < content.length ? nextOffset : null,
      totalLength: content.length,
    };
  }

  private currentBrief(
    projectId: string,
    documentId: string,
  ): ImplementationBrief | null {
    const brief = this.database.db
      .select()
      .from(implementationBriefs)
      .where(
        and(
          eq(implementationBriefs.projectId, projectId),
          eq(implementationBriefs.documentId, documentId),
        ),
      )
      .orderBy(desc(implementationBriefs.version))
      .get();
    return brief ? briefFromRow(brief) : null;
  }

  private hydrate(
    projectId: string,
    row: typeof researchDocuments.$inferSelect,
    membership: typeof projectResearchDocuments.$inferSelect,
  ): ResearchDocument {
    return {
      id: row.id,
      projectId,
      title: row.title,
      sourceKind: row.sourceKind,
      sourceReference: row.sourceReference,
      canonicalUrl: row.canonicalUrl,
      authors: row.authors,
      sourceVersion: row.sourceVersion,
      extractionStatus: row.extractionStatus,
      extractedContentAvailable: row.extractedContentReference !== null,
      extractionError: row.extractionError,
      submittedBy: membership.submittedBy,
      retrievedAt: row.retrievedAt?.toISOString() ?? null,
      currentBrief: this.currentBrief(projectId, row.id),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private writeExtractedContent(documentId: string, content: string): string {
    const reference = join('research', documentId, 'extracted.txt');
    const path = join(this.database.dataDirectory, reference);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, path);
    return reference;
  }

  private readExtractedContent(reference: string): string {
    return readFileSync(join(this.database.dataDirectory, reference), 'utf8');
  }
}

function briefFromRow(
  row: typeof implementationBriefs.$inferSelect,
): ImplementationBrief {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    version: row.version,
    summary: row.summary,
    applicability: row.applicability,
    proposedChanges: row.proposedChanges,
    risks: row.risks,
    evaluationIdeas: row.evaluationIdeas,
    sourceClaims: row.sourceClaims,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeReference(
  sourceKind: IngestResearchDocumentRequest['sourceKind'],
  sourceReference: string,
): string {
  const trimmed = sourceReference.trim();
  if (sourceKind !== 'url') return trimmed;

  const url = new URL(trimmed);
  url.hash = '';
  return url.toString();
}
