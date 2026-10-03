import { setTimeout } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  discoveryScanSchema,
  sourceSelectionSchema,
  storeRecommendationRequestSchema,
  triageRecommendationRequestSchema,
  type LibrarySearchRequest,
  type DiscoverySearchRequest,
  type DiscoveryScan,
  type SourceSelection,
  type ResearchSource,
  type StoreRecommendationRequest,
  type Recommendation,
  type TriageRecommendationRequest,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import {
  appState,
  discoveryScans,
  projectSourceSelections,
  researchRecommendations,
  recommendationTriage,
  experiments,
} from '../storage/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import type { ResearchService } from './research-service.js';
import { WorkflowError } from '../evaluations/plan-service.js';
import { sourceCatalog } from './source-catalog.js';
import { searchSource } from './source-adapters.js';
import {
  fetchPublicResource,
  SourceFetchError,
  validatePublicUrl,
  type PublicFetcher,
} from './public-fetch.js';
import { extractResource } from './extraction.js';

export class DiscoveryService {
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
    private readonly research: ResearchService,
    private readonly fetcher: PublicFetcher = fetchPublicResource,
  ) {}

  catalog() {
    return sourceCatalog;
  }

  sources(projectId: string, suggestDefaults = true) {
    const project = this.projects.get(projectId);
    const saved =
      this.database.db
        .select()
        .from(projectSourceSelections)
        .where(eq(projectSourceSelections.projectId, projectId))
        .get()?.selection;
    const context = [project.currentContext.inference?.researchDirection, ...project.objectives, project.description].join(' ').toLowerCase();
    const collection = /retriev|search|ranking/.test(context) ? 'retrieval'
      : /agent/.test(context) ? 'agents'
      : /evaluat|benchmark/.test(context) ? 'evaluation'
      : /inference|latency|efficien/.test(context) ? 'inference' : undefined;
    const selection = saved ?? sourceSelectionSchema.parse(
      !suggestDefaults ? {} : collection ? { collectionIds: [collection] } : { sourceIds: ['arxiv-ai', 'arxiv-ml'] },
    );
    const ids = new Set([
      ...selection.sourceIds,
      ...sourceCatalog.collections
        .filter((collection) => selection.collectionIds.includes(collection.id))
        .flatMap((collection) => collection.sourceIds),
    ]);
    const sources: ResearchSource[] = sourceCatalog.sources.filter(
      (source) =>
        ids.has(source.id) && !selection.excludedSourceIds.includes(source.id),
    );
    for (const feed of selection.feeds) {
      const id = `feed-${createHash('sha256').update(feed.url).digest('hex').slice(0, 20)}`;
      if (!selection.excludedSourceIds.includes(id))
        sources.push({
          id,
          name: feed.name,
          kind: 'feed',
          url: feed.url,
          coverage:
            'Available feed history (first 200 entries) and locally indexed articles; no complete historical web coverage.',
        });
    }
    return { selection, sources, selectionOrigin: saved ? 'saved' as const : 'suggested' as const };
  }

  selectSources(projectId: string, input: SourceSelection) {
    this.projects.get(projectId);
    input = sourceSelectionSchema.parse(input);
    if (
      input.collectionIds.some(
        (id) =>
          !sourceCatalog.collections.some((collection) => collection.id === id),
      ) ||
      input.sourceIds.some(
        (id) => !sourceCatalog.sources.some((source) => source.id === id),
      )
    ) {
      throw new WorkflowError(
        'UNKNOWN_SOURCE',
        'Select collections and sources from the source catalog.',
        400,
      );
    }
    for (const feed of input.feeds) validatePublicUrl(feed.url);
    input.feeds = [
      ...new Map(
        input.feeds.map((feed) => [
          new URL(feed.url).toString(),
          { ...feed, url: new URL(feed.url).toString() },
        ]),
      ).values(),
    ];
    this.database.db
      .insert(projectSourceSelections)
      .values({ projectId, selection: input })
      .onConflictDoUpdate({
        target: projectSourceSelections.projectId,
        set: { selection: input },
      })
      .run();
    return this.sources(projectId);
  }

  async search(
    projectId: string,
    input: DiscoverySearchRequest,
  ): Promise<DiscoveryScan> {
    const { sources } = this.sources(projectId, input.useSuggestedSources ?? false);
    const scan: DiscoveryScan = {
      id: randomUUID(),
      projectId,
      query: input.query,
      createdAt: new Date().toISOString(),
      documentIds: [],
      outcomes: [],
      analysisStatus: 'waiting_for_agent',
    };
    let reservedArxivRetry: string | undefined;
    for (const source of sources) {
      const key =
        source.kind === 'arxiv'
          ? 'research:arxiv:retry'
          : `research:${source.id}:retry`;
      let retryAt = this.database.db
        .select()
        .from(appState)
        .where(eq(appState.key, key))
        .get()?.value;
      if (
        retryAt &&
        retryAt === reservedArxivRetry &&
        Date.parse(retryAt) > Date.now()
      ) {
        await setTimeout(Date.parse(retryAt) - Date.now());
        retryAt = this.database.db
          .select()
          .from(appState)
          .where(eq(appState.key, key))
          .get()?.value;
      }
      if (retryAt && Date.parse(retryAt) > Date.now()) {
        scan.outcomes.push({
          sourceId: source.id,
          status: 'rate_limited',
          coverage: source.coverage,
          count: 0,
          nextOffset: input.offsets[source.id] ?? 0,
          retryAt,
          error: 'Source is cooling down; retry at the reported time.',
        });
        continue;
      }
      // Reserve the arXiv request interval before yielding to the network.
      if (source.kind === 'arxiv') {
        reservedArxivRetry = new Date(Date.now() + 3000).toISOString();
        this.cooldown(key, reservedArxivRetry);
      }
      try {
        const page = await searchSource(
          source,
          input.query,
          input.offsets[source.id] ?? 0,
          input.limit,
          this.fetcher,
        );
        for (const document of page.documents) {
          const stored = this.research.ingest(projectId, document);
          if (!scan.documentIds.includes(stored.id))
            scan.documentIds.push(stored.id);
        }
        scan.outcomes.push({
          sourceId: source.id,
          status: 'ok',
          coverage: source.coverage,
          count: page.documents.length,
          nextOffset: page.nextOffset,
          retryAt: null,
          error: null,
        });
      } catch (error) {
        const retry = error instanceof SourceFetchError ? error.retryAt : null;
        if (retry) this.cooldown(key, retry);
        scan.outcomes.push({
          sourceId: source.id,
          status: retry ? 'rate_limited' : 'failed',
          coverage: source.coverage,
          count: 0,
          nextOffset: input.offsets[source.id] ?? 0,
          retryAt: retry,
          error: (error instanceof Error
            ? error.message
            : 'Source failed.'
          ).slice(0, 2000),
        });
      }
    }
    this.database.db
      .insert(discoveryScans)
      .values({ id: scan.id, projectId, payload: scan })
      .run();
    return this.scanStatus(scan);
  }

  scans(projectId: string) {
    this.projects.get(projectId);
    return this.database.db
      .select()
      .from(discoveryScans)
      .where(eq(discoveryScans.projectId, projectId))
      .orderBy(
        desc(sql`json_extract(${discoveryScans.payload}, '$.createdAt')`),
      )
      .limit(50)
      .all()
      .map((row) => this.scanStatus(row.payload));
  }

  async fetchDocument(projectId: string, documentId: string) {
    const document = this.research.get(projectId, documentId);
    const url =
      document.sourceKind === 'arxiv'
        ? `https://arxiv.org/pdf/${document.sourceReference}${document.sourceVersion?.match(/^v\d+$/) ? document.sourceVersion : ''}`
        : (document.canonicalUrl ??
          (document.sourceKind === 'url' ? document.sourceReference : null));
    if (!url)
      throw new WorkflowError(
        'NO_DOCUMENT_URL',
        'This citation has no downloadable URL. Supply text or a public URL.',
        400,
      );
    let extracted;
    try {
      extracted = await extractResource(await this.fetcher(url));
    } catch (error) {
      extracted = {
        status: 'failed' as const,
        error: (error instanceof Error
          ? error.message
          : 'Download failed.'
        ).slice(0, 2000),
      };
    }
    return this.research.ingest(projectId, {
      title: extracted.title ?? document.title,
      sourceKind: document.sourceKind,
      sourceReference: document.sourceReference,
      ...(document.canonicalUrl ? { canonicalUrl: document.canonicalUrl } : {}),
      authors: document.authors,
      ...(document.sourceVersion
        ? { sourceVersion: document.sourceVersion }
        : {}),
      extractionStatus: extracted.status,
      ...(extracted.content ? { extractedContent: extracted.content } : {}),
      ...(extracted.error ? { extractionError: extracted.error } : {}),
      submittedBy: document.submittedBy,
      retrievedAt: new Date().toISOString(),
    });
  }

  async fetchUrl(projectId: string, url: string) {
    this.projects.get(projectId);
    validatePublicUrl(url);
    const document = this.research.ingest(projectId, {
      title: url,
      sourceKind: 'url',
      sourceReference: url,
      authors: [],
      extractionStatus: 'pending',
      submittedBy: 'user',
    });
    return this.fetchDocument(projectId, document.id);
  }

  recommendations(
    projectId: string,
    offset = 0,
    limit = 100,
    options: { view?: 'all' | 'actionable' | 'history'; query?: string } = {},
  ) {
    const project = this.projects.get(projectId);
    const contextVersion = project.currentContext.version;
    const terms = Array.from(new Set([
      options.query,
      project.currentContext.inference?.researchDirection,
      ...project.objectives,
      ...(!project.objectives.length ? [project.description] : []),
    ].join(' ').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []))
      .filter((term) => !['the', 'and', 'for', 'with', 'from', 'this', 'that', 'project', 'improve', 'reduce', 'while', 'keeping', 'research'].includes(term))
      .slice(0, 16);
    const payload = researchRecommendations.payload;
    const current = sql`json_extract(${payload}, '$.proposal.projectContextVersion') = ${contextVersion}`;
    const undecided = sql`json_extract(${payload}, '$.state') = 'new'`;
    const searchable = sql`lower(json_extract(${payload}, '$.proposal.title') || ' ' || json_extract(${payload}, '$.proposal.summary') || ' ' || json_extract(${payload}, '$.proposal.applicability') || ' ' || json_extract(${payload}, '$.proposal.evaluationTargets'))`;
    const score = terms.length ? sql.join(terms.map(term => sql`(instr(${searchable}, ${term}) > 0)`), sql` + `) : sql`(0 + 0)`;
    const view = options.view ?? 'all';
    return this.database.db
      .select()
      .from(researchRecommendations)
      .where(and(
        eq(researchRecommendations.projectId, projectId),
        view === 'actionable' ? sql`(${current}) AND (${undecided})`
          : view === 'history' ? sql`NOT ((${current}) AND (${undecided}))` : undefined,
      ))
      .orderBy(desc(current), desc(score), desc(sql`json_extract(${payload}, '$.createdAt')`), desc(researchRecommendations.id))
      .limit(limit)
      .offset(offset)
      .all()
      .map(({ payload: item }) => {
        const text = [item.proposal.title, item.proposal.summary, item.proposal.applicability, JSON.stringify(item.proposal.evaluationTargets)].join(' ').toLowerCase();
        return { ...item, relevance: {
          contextCurrent: item.proposal.projectContextVersion === contextVersion,
          matchedTerms: terms.filter(term => text.includes(term)),
        } };
      });
  }

  storeRecommendation(
    projectId: string,
    input: StoreRecommendationRequest,
  ): Recommendation {
    input = storeRecommendationRequestSchema.parse(input);
    const project = this.projects.get(projectId);
    this.research.get(projectId, input.documentId);
    input.sources = input.sources.map((source) => {
      const document = this.research.get(projectId, source.documentId);
      if (
        source.sourceVersion !== undefined &&
        source.sourceVersion !== document.sourceVersion
      )
        throw new WorkflowError(
          'STALE_SOURCE_VERSION',
          'Read the current source version and reassess the recommendation.',
          409,
        );
      return { ...source, sourceVersion: document.sourceVersion };
    });
    if (input.projectContextVersion !== project.currentContext.version)
      throw new WorkflowError(
        'STALE_PROJECT_CONTEXT',
        'Refresh project context and reassess applicability before submitting.',
        409,
      );
    const existing = this.database.db
      .select()
      .from(researchRecommendations)
      .where(
        and(
          eq(researchRecommendations.projectId, projectId),
          eq(researchRecommendations.documentId, input.documentId),
        ),
      )
      .get()?.payload;
    const now = new Date().toISOString();
    const recommendation: Recommendation = {
      id: existing?.id ?? randomUUID(),
      projectId,
      documentId: input.documentId,
      proposal: input,
      revision: (existing?.revision ?? 0) + 1,
      state: existing?.state ?? 'new',
      reason: existing?.reason ?? '',
      experimentId: existing?.experimentId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.database.db
      .insert(researchRecommendations)
      .values({
        id: recommendation.id,
        projectId,
        documentId: input.documentId,
        payload: recommendation,
      })
      .onConflictDoUpdate({
        target: [
          researchRecommendations.projectId,
          researchRecommendations.documentId,
        ],
        set: { payload: recommendation },
      })
      .run();
    return recommendation;
  }

  triage(
    projectId: string,
    id: string,
    input: TriageRecommendationRequest,
  ): Recommendation {
    input = triageRecommendationRequestSchema.parse(input);
    this.projects.get(projectId);
    const row = this.database.db
      .select()
      .from(researchRecommendations)
      .where(
        and(
          eq(researchRecommendations.id, id),
          eq(researchRecommendations.projectId, projectId),
        ),
      )
      .get();
    if (!row)
      throw new WorkflowError(
        'RECOMMENDATION_NOT_FOUND',
        'Recommendation not found in this project.',
        404,
      );
    if (input.experimentId) {
      const experiment = this.database.db
        .select()
        .from(experiments)
        .where(
          and(
            eq(experiments.id, input.experimentId),
            eq(experiments.projectId, projectId),
            eq(experiments.documentId, row.documentId),
          ),
        )
        .get();
      if (!experiment || experiment.status !== 'completed')
        throw new WorkflowError(
          'INVALID_EXPERIMENT_EVIDENCE',
          'Link a completed experiment for this project and document.',
          400,
        );
    }
    const now = new Date().toISOString();
    const recommendation = {
      ...row.payload,
      state: input.state,
      reason: input.reason,
      experimentId: input.experimentId ?? null,
      updatedAt: now,
    };
    this.database.db.transaction((tx) => {
      tx.update(researchRecommendations)
        .set({ payload: recommendation })
        .where(eq(researchRecommendations.id, id))
        .run();
      tx.insert(recommendationTriage)
        .values({
          id: randomUUID(),
          recommendationId: id,
          state: input.state,
          reason: input.reason,
          experimentId: input.experimentId ?? null,
          createdAt: now,
        })
        .run();
    });
    return recommendation;
  }

  triageHistory(projectId: string, id: string) {
    this.projects.get(projectId);
    if (
      !this.database.db
        .select()
        .from(researchRecommendations)
        .where(
          and(
            eq(researchRecommendations.id, id),
            eq(researchRecommendations.projectId, projectId),
          ),
        )
        .get()
    )
      throw new WorkflowError(
        'RECOMMENDATION_NOT_FOUND',
        'Recommendation not found in this project.',
        404,
      );
    return this.database.db
      .select({
        state: recommendationTriage.state,
        reason: recommendationTriage.reason,
        experimentId: recommendationTriage.experimentId,
        createdAt: recommendationTriage.createdAt,
      })
      .from(recommendationTriage)
      .where(eq(recommendationTriage.recommendationId, id))
      .orderBy(desc(recommendationTriage.createdAt))
      .limit(100)
      .all();
  }

  pendingAnalysis(projectId: string, page: LibrarySearchRequest) {
    this.projects.get(projectId);
    const ids = this.database.sqlite
      .prepare(
        `SELECT m.document_id AS id FROM project_research_documents m
      LEFT JOIN research_recommendations r ON r.project_id = m.project_id AND r.document_id = m.document_id
      WHERE m.project_id = ? AND r.id IS NULL ORDER BY m.added_at, m.document_id LIMIT ? OFFSET ?`,
      )
      .all(projectId, page.limit, page.offset) as Array<{ id: string }>;
    return ids.map(({ id }) => this.research.get(projectId, id));
  }

  private scanStatus(scan: DiscoveryScan): DiscoveryScan {
    const pending = scan.documentIds.some(
      (documentId) =>
        !this.database.db
          .select({ id: researchRecommendations.id })
          .from(researchRecommendations)
          .where(
            and(
              eq(researchRecommendations.projectId, scan.projectId),
              eq(researchRecommendations.documentId, documentId),
            ),
          )
          .get(),
    );
    return discoveryScanSchema.parse({
      ...scan,
      analysisStatus: pending ? 'waiting_for_agent' : 'complete',
    });
  }

  private cooldown(key: string, retryAt: string) {
    this.database.db
      .insert(appState)
      .values({ key, value: retryAt, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value: retryAt, updatedAt: new Date() },
      })
      .run();
  }
}
