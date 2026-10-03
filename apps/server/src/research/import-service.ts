import { createHash, randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  ingestResearchDocumentRequestSchema,
  type IngestResearchDocumentRequest,
  type ResearchImportInput,
  type ResearchImportPreview,
  type ResearchImportCommit,
} from '@paperloop/contracts';
import type { ProjectService } from '../projects/project-service.js';
import type { ResearchService } from './research-service.js';
import { WorkflowError } from '../evaluations/plan-service.js';
import { extractResource } from './extraction.js';
import { normalizeIdentity } from './identity.js';
import {
  fetchPublicResource,
  validatePublicUrl,
  type PublicFetcher,
  type PublicResource,
} from './public-fetch.js';

export class ResearchImportService {
  private readonly previews = new Map<
    string,
    { projectId: string; expires: number; preview: ResearchImportPreview }
  >();
  constructor(
    private readonly projects: ProjectService,
    private readonly research: ResearchService,
    private readonly fetcher: PublicFetcher = fetchPublicResource,
  ) {}
  async preview(
    projectId: string,
    input: ResearchImportInput,
  ): Promise<ResearchImportPreview> {
    this.projects.get(projectId);
    const notes: string[] = [];
    let inputKind: ResearchImportPreview['inputKind'] = 'reference';
    const text = input.input.trim();
    let document: IngestResearchDocumentRequest = {
      title:
        text.split('\n')[0]!.slice(0, 500) ||
        input.file?.name ||
        'Imported paper',
      sourceKind: 'reference',
      sourceReference: text.slice(0, 2048) || 'file',
      authors: [],
      extractionStatus: 'unavailable',
      submittedBy: 'user',
    };
    let resource: PublicResource | undefined;
    const doi =
      /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i.exec(
        text,
      );
    const arxiv =
      /^(?:arxiv:)?(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(
        text,
      );
    try {
      if (input.file) {
        inputKind = 'file';
        const data = input.file.data;
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data))
          throw new WorkflowError(
            'INVALID_FILE',
            'The file encoding is invalid.',
            400,
          );
        const body = Buffer.from(data, 'base64');
        if (!body.length || body.length > 1024 * 1024)
          throw new WorkflowError(
            'INVALID_FILE',
            'Choose a nonempty PDF or text file up to 1 MiB.',
            400,
          );
        document.sourceReference = `file:sha256:${createHash('sha256').update(body).digest('hex')}`;
        document.title = input.file.name;
        resource = {
          url: 'https://paperloop.invalid/import',
          contentType:
            input.file.contentType ||
            (/\.pdf$/i.test(input.file.name)
              ? 'application/pdf'
              : /\.txt$/i.test(input.file.name)
                ? 'text/plain'
                : 'application/octet-stream'),
          body,
        };
        notes.push(
          `Uploaded file: ${input.file.name}. Metadata may need correction.`,
        );
      } else if (doi) {
        inputKind = 'doi';
        const reference = doi[1]!;
        document.sourceReference = `https://doi.org/${reference}`;
        document.sourceKind = 'url';
        document.canonicalUrl = document.sourceReference;
        const metadata = await this.fetcher(
          `https://api.crossref.org/works/${encodeURIComponent(reference)}`,
        );
        const message = (
          JSON.parse(new TextDecoder().decode(metadata.body)) as {
            message?: {
              title?: string[];
              author?: Array<{ given?: string; family?: string }>;
              abstract?: string;
            };
          }
        ).message;
        if (message?.title?.[0])
          document.title = message.title[0].slice(0, 500);
        document.authors = (message?.author ?? [])
          .map((author) =>
            `${author.given ?? ''} ${author.family ?? ''}`.trim(),
          )
          .filter(Boolean)
          .slice(0, 100)
          .map((author) => author.slice(0, 200));
        notes.push(
          'Metadata resolved from Crossref. Publisher full text may be unavailable.',
        );
        resource = await this.fetcher(document.canonicalUrl);
      } else if (arxiv || /^https?:\/\//i.test(text)) {
        document = {
          ...document,
          ...normalizeIdentity({
            sourceKind: arxiv ? 'arxiv' : 'url',
            sourceReference: text,
          }),
        };
        inputKind = document.sourceKind === 'arxiv' ? 'arxiv' : 'url';
        document.canonicalUrl =
          document.sourceKind === 'arxiv'
            ? `https://arxiv.org/abs/${document.sourceReference}${document.sourceVersion ?? ''}`
            : document.sourceReference;
        validatePublicUrl(document.canonicalUrl);
        if (document.sourceKind === 'arxiv') {
          const metadata = await this.fetcher(
            `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(document.sourceReference + (document.sourceVersion ?? ''))}`,
          );
          const xml = new TextDecoder().decode(metadata.body);
          if (
            /<!DOCTYPE|<!ENTITY/i.test(xml) ||
            XMLValidator.validate(xml) !== true
          )
            throw new Error('arXiv returned invalid metadata.');
          const entry = (
            new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(
              xml,
            ) as {
              feed?: {
                entry?: {
                  title?: string;
                  author?: { name?: string } | Array<{ name?: string }>;
                  summary?: string;
                };
              };
            }
          ).feed?.entry;
          if (entry?.title)
            document.title = entry.title
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 500);
          const authors = entry?.author
            ? Array.isArray(entry.author)
              ? entry.author
              : [entry.author]
            : [];
          document.authors = authors
            .map((author) => author.name ?? '')
            .filter(Boolean)
            .slice(0, 100)
            .map((author) => author.slice(0, 200));
          if (entry?.summary) {
            document.extractedContent = entry.summary.trim();
            document.extractionStatus = 'partial';
          }
          notes.push(
            'arXiv metadata and abstract; full-text availability is shown below.',
          );
        }
        resource = await this.fetcher(
          document.sourceKind === 'arxiv'
            ? `https://arxiv.org/pdf/${document.sourceReference}${document.sourceVersion ?? ''}`
            : document.canonicalUrl,
        );
      } else if (text.length > 2048 || text.includes('\n')) {
        inputKind = 'text';
        document.sourceReference = `text:sha256:${createHash('sha256').update(text).digest('hex')}`;
        document.extractedContent = text;
        document.extractionStatus = 'complete';
        notes.push(
          'Title inferred from the first line. Authors and source are unverified.',
        );
      } else {
        notes.push(
          'Citation retained as supplied. Title and authors are unverified; add text if available.',
        );
      }
      if (resource) {
        const extracted = await extractResource(resource);
        if (extracted.title && inputKind !== 'doi' && inputKind !== 'arxiv')
          document.title = extracted.title.slice(0, 500);
        if (extracted.content) {
          document.extractedContent = extracted.content;
          document.extractionStatus = extracted.status;
        } else if (!document.extractedContent)
          document.extractionStatus = extracted.status;
        if (extracted.error) document.extractionError = extracted.error;
        if (
          resource.contentType.includes('html') &&
          inputKind !== 'doi' &&
          inputKind !== 'arxiv'
        ) {
          const dom = new JSDOM(new TextDecoder().decode(resource.body));
          try {
            const metadataTitle = dom.window.document
              .querySelector('meta[name="citation_title"]')
              ?.getAttribute('content');
            if (metadataTitle) document.title = metadataTitle.slice(0, 500);
            const authors = [
              ...dom.window.document.querySelectorAll(
                'meta[name="citation_author"]',
              ),
            ]
              .map((node) => node.getAttribute('content')?.trim() ?? '')
              .filter(Boolean)
              .slice(0, 100);
            if (authors.length)
              document.authors = authors.map((author) => author.slice(0, 200));
          } finally {
            dom.window.close();
          }
        }
        document.retrievedAt = new Date().toISOString();
      }
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      document.extractionStatus = document.extractedContent
        ? 'partial'
        : 'failed';
      document.extractionError = (
        error instanceof Error ? error.message : 'Import lookup failed.'
      ).slice(0, 2000);
      notes.push(
        'Lookup or extraction failed. Review the reference and supply missing metadata or text.',
      );
    }
    if (!document.authors.length) notes.push('Authors were not identified.');
    const normalized = normalizeIdentity(document);
    document = ingestResearchDocumentRequestSchema.parse({
      ...document,
      ...normalized,
    });
    const duplicateId = this.research.findIdentity(
      document.sourceKind,
      document.sourceReference,
    );
    const preview = {
      id: randomUUID(),
      inputKind,
      document,
      notes,
      duplicateId,
    };
    for (const [id, value] of this.previews)
      if (value.expires < Date.now()) this.previews.delete(id);
    if (this.previews.size >= 32)
      this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.id, {
      projectId,
      expires: Date.now() + 15 * 60_000,
      preview,
    });
    return preview;
  }
  commit(projectId: string, input: ResearchImportCommit) {
    const stored = this.previews.get(input.previewId);
    if (
      !stored ||
      stored.projectId !== projectId ||
      stored.expires < Date.now()
    )
      throw new WorkflowError(
        'IMPORT_EXPIRED',
        'Preview expired or does not belong to this project. Preview the import again.',
        409,
      );
    const duplicateId = this.research.findIdentity(stored.preview.document.sourceKind, stored.preview.document.sourceReference);
    const existing = duplicateId ? this.research.attach(projectId, duplicateId) : null;
    const preserveText = existing?.extractedContentAvailable && existing.sourceVersion === (stored.preview.document.sourceVersion ?? null) && !stored.preview.document.extractedContent && !input.extractedContent;
    const document = this.research.ingest(
      projectId,
      ingestResearchDocumentRequestSchema.parse({
        ...stored.preview.document,
        ...(preserveText ? { extractionStatus: 'pending', extractionError: undefined } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.authors ? { authors: input.authors } : {}),
        ...(input.extractedContent
          ? {
              extractedContent: input.extractedContent,
              extractionStatus: 'complete',
              extractionError: undefined,
            }
          : {}),
      }),
    );
    this.previews.delete(input.previewId);
    return this.research.recordImport(projectId, document.id, [
      `Input type: ${stored.preview.inputKind}`,
      ...stored.preview.notes,
      ...(input.title || input.authors || input.extractedContent
        ? ['Metadata/text reviewed by the importing user.']
        : []),
    ]);
  }
}
