import { createHash, randomUUID } from 'node:crypto';
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
  appState,
  implementationBriefs,
  projectResearchDocuments,
  researchDocuments,
  researchVersions,
} from '../storage/schema.js';

import { normalizeIdentity } from './identity.js';
import type { LibrarySearchRequest } from '@paperloop/contracts';

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
  ) {
    // Backfill extracted text for documents indexed before FTS was introduced.
    const rows = this.database.sqlite
      .prepare(
        "SELECT d.id, d.title, d.authors, d.extracted_content_reference AS reference FROM research_documents d JOIN research_search s ON s.document_id = d.id WHERE s.content = '' AND d.extracted_content_reference IS NOT NULL",
      )
      .all() as Array<{
      id: string;
      title: string;
      authors: string;
      reference: string;
    }>;
    for (const row of rows) {
      let content: string;
      try {
        content = this.readExtractedContent(row.reference);
      } catch {
        const error =
          'Stored extracted text is missing or unreadable. Fetch it again or restore the document artifact.';
        this.database.db.transaction((tx) => {
          tx.update(researchDocuments)
            .set({
              extractionStatus: 'failed',
              extractionError: error,
              extractedContentReference: null,
            })
            .where(eq(researchDocuments.id, row.id))
            .run();
          tx.update(researchVersions)
            .set({
              extractionStatus: 'failed',
              extractionError: error,
              contentReference: null,
            })
            .where(
              and(
                eq(researchVersions.documentId, row.id),
                eq(researchVersions.contentReference, row.reference),
              ),
            )
            .run();
        });
        continue;
      }
      this.indexDocument(
        row.id,
        row.title,
        JSON.parse(row.authors) as string[],
        content,
      );
    }
  }

  ingest(
    projectId: string,
    input: IngestResearchDocumentRequest,
  ): ResearchDocument {
    this.projects.get(projectId);
    const now = new Date();
    const identity = normalizeIdentity(input);
    input = { ...input, ...identity };
    const sourceReference = identity.sourceReference;
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
    const authors = input.authors.length
      ? input.authors
      : (existing?.authors ?? []);
    const oldNumber = Number(existing?.sourceVersion?.replace(/^v/, ''));
    const newNumber = Number(input.sourceVersion?.replace(/^v/, ''));
    const olderVersion =
      input.sourceKind === 'arxiv' &&
      Number.isFinite(oldNumber) &&
      Number.isFinite(newNumber) &&
      newNumber < oldNumber;
    const versionChanged = Boolean(
      existing &&
        input.sourceVersion &&
        input.sourceVersion !== existing.sourceVersion,
    );
    const preserveExtraction = Boolean(
      existing &&
        !versionChanged &&
        (input.extractionStatus === 'pending' ||
          (existing.extractionStatus === 'complete' &&
            input.extractionStatus === 'partial')),
    );
    const status =
      olderVersion || preserveExtraction
        ? existing!.extractionStatus
        : input.extractionStatus;
    const extractedContentReference =
      olderVersion || preserveExtraction
        ? existing!.extractedContentReference
        : input.extractedContent
          ? this.writeExtractedContent(documentId, input.extractedContent)
          : versionChanged
            ? null
            : (existing?.extractedContentReference ?? null);
    const sourceVersion = olderVersion
      ? existing!.sourceVersion
      : (input.sourceVersion ?? existing?.sourceVersion ?? null);
    const extractionError =
      olderVersion || preserveExtraction
        ? existing!.extractionError
        : (input.extractionError ?? null);

    const historicalContentReference =
      olderVersion && input.extractedContent
        ? this.writeExtractedContent(documentId, input.extractedContent)
        : null;

    this.database.db.transaction((transaction) => {
      if (existing) {
        transaction
          .update(researchDocuments)
          .set({
            title: olderVersion ? existing!.title : input.title,
            canonicalUrl: olderVersion
              ? existing.canonicalUrl
              : (input.canonicalUrl ?? existing.canonicalUrl),
            authors,
            sourceVersion,
            extractionStatus: status,
            extractedContentReference,
            extractionError,
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
            title: olderVersion ? existing!.title : input.title,
            sourceKind: input.sourceKind,
            sourceReference,
            canonicalUrl: input.canonicalUrl ?? null,
            authors,
            sourceVersion,
            extractionStatus: status,
            extractedContentReference,
            extractionError,
            retrievedAt: input.retrievedAt ? new Date(input.retrievedAt) : null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      if (
        olderVersion &&
        !this.database.db
          .select()
          .from(researchVersions)
          .where(
            and(
              eq(researchVersions.documentId, documentId),
              eq(researchVersions.sourceVersion, input.sourceVersion!),
            ),
          )
          .all()
          .some(
            (version) =>
              version.contentReference === historicalContentReference &&
              version.extractionStatus === input.extractionStatus,
          )
      ) {
        transaction
          .insert(researchVersions)
          .values({
            id: randomUUID(),
            documentId,
            sourceVersion: input.sourceVersion!,
            extractionStatus: input.extractionStatus,
            extractionError: input.extractionError ?? null,
            contentReference: historicalContentReference,
            retrievedAt: input.retrievedAt ?? now.toISOString(),
          })
          .run();
      }
      if (
        !existing ||
        sourceVersion !== existing.sourceVersion ||
        status !== existing.extractionStatus ||
        extractedContentReference !== existing.extractedContentReference ||
        extractionError !== existing.extractionError
      ) {
        transaction
          .insert(researchVersions)
          .values({
            id: randomUUID(),
            documentId,
            sourceVersion,
            extractionStatus: status,
            extractionError,
            contentReference: extractedContentReference,
            retrievedAt: input.retrievedAt ?? now.toISOString(),
          })
          .run();
      }
      this.indexDocument(
        documentId,
        olderVersion ? existing!.title : input.title,
        authors,
        extractedContentReference
          ? this.readExtractedContent(extractedContentReference)
          : '',
      );
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
      .limit(100)
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
    let reference = row?.reference;
    if (input.versionId) {
      const version = this.database.db
        .select()
        .from(researchVersions)
        .where(
          and(
            eq(researchVersions.id, input.versionId),
            eq(researchVersions.documentId, documentId),
          ),
        )
        .get();
      if (!version) throw new ResearchDocumentNotFoundError(input.versionId);
      reference = version.contentReference;
    }
    const content = reference ? this.readExtractedContent(reference) : '';
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

  findIdentity(sourceKind: string, sourceReference: string): string | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id FROM research_documents WHERE source_kind = ? AND source_reference = ?',
      )
      .get(sourceKind, sourceReference) as { id: string } | undefined;
    return row?.id ?? null;
  }
  recordImport(projectId: string, documentId: string, notes: string[]) {
    this.get(projectId, documentId);
    const key = `research-import:${projectId}:${documentId}`;
    const value = JSON.stringify(notes);
    this.database.db
      .insert(appState)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value, updatedAt: new Date() },
      })
      .run();
    return this.get(projectId, documentId);
  }

  searchLibrary(input: LibrarySearchRequest, projectId?: string) {
    if (projectId) this.projects.get(projectId);
    const tokens = input.query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    const match = tokens.map((token) => `"${token}"`).join(' AND ');
    const conditions: string[] = [];
    const bindings: (string | number)[] = [];
    if (input.query && !match) return { documents: [], nextOffset: null };
    if (match) {
      conditions.push('research_search MATCH ?');
      bindings.push(match);
    }
    if (projectId) {
      conditions.push(
        'EXISTS (SELECT 1 FROM project_research_documents m WHERE m.document_id = d.id AND m.project_id = ?)',
      );
      bindings.push(projectId);
    }
    const rows = this.database.sqlite
      .prepare(
        `SELECT d.id FROM research_documents d JOIN research_search ON research_search.document_id = d.id ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY ${match ? 'bm25(research_search), ' : ''}d.created_at DESC, d.id LIMIT ? OFFSET ?`,
      )
      .all(...bindings, input.limit + 1, input.offset) as Array<{ id: string }>;
    return {
      documents: rows.slice(0, input.limit).map(({ id }) => {
        const row = this.database.db
          .select()
          .from(researchDocuments)
          .where(eq(researchDocuments.id, id))
          .get()!;
        return {
          id: row.id,
          title: row.title,
          authors: row.authors,
          sourceKind: row.sourceKind,
          sourceReference: row.sourceReference,
          sourceVersion: row.sourceVersion,
          canonicalUrl: row.canonicalUrl,
          extractionStatus: row.extractionStatus,
        };
      }),
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
    };
  }

  attach(projectId: string, documentId: string): ResearchDocument {
    this.projects.get(projectId);
    if (
      !this.database.db
        .select()
        .from(researchDocuments)
        .where(eq(researchDocuments.id, documentId))
        .get()
    )
      throw new ResearchDocumentNotFoundError(documentId);
    this.database.db
      .insert(projectResearchDocuments)
      .values({
        id: randomUUID(),
        projectId,
        documentId,
        submittedBy: 'user',
        addedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
    return this.get(projectId, documentId);
  }

  versions(projectId: string, documentId: string) {
    this.get(projectId, documentId);
    return this.database.db
      .select()
      .from(researchVersions)
      .where(eq(researchVersions.documentId, documentId))
      .orderBy(desc(researchVersions.retrievedAt))
      .limit(100)
      .all()
      .map((row) => ({
        id: row.id,
        documentId,
        sourceVersion: row.sourceVersion,
        extractionStatus: row.extractionStatus,
        extractionError: row.extractionError,
        retrievedAt: row.retrievedAt,
        contentAvailable: row.contentReference !== null,
      }));
  }

  private indexDocument(
    id: string,
    title: string,
    authors: string[],
    content: string,
  ): void {
    this.database.sqlite
      .prepare('DELETE FROM research_search WHERE document_id = ?')
      .run(id);
    this.database.sqlite
      .prepare(
        'INSERT INTO research_search (document_id, title, authors, content) VALUES (?, ?, ?, ?)',
      )
      .run(id, title, authors.join(' '), content);
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
      importNotes: JSON.parse(
        this.database.db
          .select()
          .from(appState)
          .where(eq(appState.key, `research-import:${projectId}:${row.id}`))
          .get()?.value ?? '[]',
      ) as string[],
      currentBrief: this.currentBrief(projectId, row.id),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private writeExtractedContent(documentId: string, content: string): string {
    const digest = createHash('sha256').update(content).digest('hex');
    const reference = join('research', documentId, `${digest}.txt`);
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
