import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { SUPPORTED_SCHEMA_VERSION } from '../storage/database.js';
import { extractResource } from './extraction.js';
import {
  SourceFetchError,
  isPublicAddress,
  validatePublicUrl,
  type PublicFetcher,
} from './public-fetch.js';
import { searchSource } from './source-adapters.js';
import { sourceCatalog } from './source-catalog.js';
import {
  discoverySearchRequestSchema,
  sourceSelectionSchema,
} from '@paperloop/contracts';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const headers = { authorization: 'Bearer discovery-test' };
function resource(
  body: string,
  contentType = 'application/atom+xml',
  url = 'https://example.com/feed',
) {
  return { body: Buffer.from(body), contentType, url };
}
function setup(fetcher?: PublicFetcher, directory?: string) {
  const dataDirectory =
    directory ?? mkdtempSync(join(tmpdir(), 'paperloop-discovery-'));
  if (!directory)
    cleanup.push(() => rmSync(dataDirectory, { recursive: true, force: true }));
  const app = createApp({
    connectionSecret: 'discovery-test',
    logger: false,
    storage: { dataDirectory },
    ...(fetcher ? { researchFetcher: fetcher } : {}),
  });
  cleanup.push(() => app.close());
  return app;
}
function project(app: ReturnType<typeof createApp>) {
  return app.projects.create({
    name: 'Retrieval project',
    description: 'Improve retrieval while measuring latency.',
    objectives: [],
    constraints: [],
  });
}
const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>3</opensearch:totalResults><entry><id>http://arxiv.org/abs/2401.01234v2</id><title>Retrieval study</title><summary>Search quality and ranking.</summary><author><name>Ada</name></author></entry></feed>`;
const rss = `<rss version="2.0"><channel><title>Engineering</title><item><title>Retrieval study</title><link>https://arxiv.org/abs/2401.01234v2</link><description>Search quality and ranking.</description></item><item><title>Useful cache</title><link>https://example.com/cache?utm_source=feed</link><description>Latency from a cache.</description></item></channel></rss>`;
function proposal(documentId: string, contextVersion = 1) {
  return {
    documentId,
    title: 'Improve ranking',
    summary: 'Try source-backed retrieval changes.',
    applicability: 'Applies to the retrieval objective.',
    prerequisites: ['A labeled query set'],
    uncertainty: 'Source benchmarks may not transfer.',
    evaluationTargets: ['Measure recall and p95 latency'],
    sources: [
      {
        documentId,
        claim: 'Ranking may improve recall.',
        evidence: 'The source discusses ranking quality.',
      },
    ],
    projectContextVersion: contextVersion,
  };
}

describe('source discovery and durable analysis', () => {
  it('persists selections, deduplicates adapters, reports pagination, coverage and isolated source failures', async () => {
    const app = setup(async (url) => {
      if (url.includes('broken')) throw new Error('Feed unavailable');
      return resource(url.includes('export.arxiv') ? atom : rss);
    });
    const first = project(app);
    app.discovery.selectSources(
      first.id,
      sourceSelectionSchema.parse({
        sourceIds: ['arxiv-ir'],
        feeds: [
          { name: 'Engineering', url: 'https://example.com/feed' },
          { name: 'Broken', url: 'https://example.com/broken' },
        ],
      }),
    );
    const result = await app.inject({
      headers,
      method: 'POST',
      url: `/api/v1/projects/${first.id}/discovery/search`,
      payload: { query: '', limit: 1 },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      analysisStatus: 'waiting_for_agent',
      outcomes: [
        { sourceId: 'arxiv-ir', status: 'ok', nextOffset: 1 },
        { status: 'ok', nextOffset: 1 },
        { status: 'failed', error: 'Feed unavailable' },
      ],
    });
    expect(result.json().documentIds).toHaveLength(1);
    expect(app.research.list(first.id)).toMatchObject([
      {
        sourceKind: 'arxiv',
        sourceReference: '2401.01234',
        sourceVersion: 'v2',
      },
    ]);
    const feedId = app.discovery.sources(first.id).sources[1]!.id;
    const next = await app.discovery.search(
      first.id,
      discoverySearchRequestSchema.parse({
        offsets: { [feedId]: 1 },
        limit: 1,
      }),
    );
    expect(next.outcomes[0]).toMatchObject({
      status: 'rate_limited',
      nextOffset: 0,
    });
    expect(next.outcomes[1]).toMatchObject({
      status: 'ok',
      count: 1,
      nextOffset: null,
    });
    expect(next.outcomes[1]!.coverage).toContain('no complete historical');
    expect(app.research.list(first.id)).toHaveLength(2);
    const saved = app.discovery.scans(first.id);
    expect(saved).toHaveLength(2);
    const second = project(app);
    expect(app.discovery.sources(second.id).sources).toEqual([]);
    expect(() =>
      app.discovery.selectSources(
        second.id,
        sourceSelectionSchema.parse({ collectionIds: ['unknown'] }),
      ),
    ).toThrow('Select collections');
  });

  it('honors Retry-After across restart without fetching or paid analysis', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paperloop-rate-limit-'));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    let calls = 0;
    const first = setup(async () => {
      calls++;
      throw new SourceFetchError(
        'Source returned HTTP 429.',
        new Date(Date.now() + 60000).toISOString(),
      );
    }, directory);
    const owner = project(first);
    first.discovery.selectSources(
      owner.id,
      sourceSelectionSchema.parse({
        feeds: [{ name: 'Throttled', url: 'https://example.com/feed' }],
      }),
    );
    const result = await first.discovery.search(
      owner.id,
      discoverySearchRequestSchema.parse({}),
    );
    expect(result.outcomes[0]!.status).toBe('rate_limited');
    expect(calls).toBe(1);
    await first.close();
    cleanup.pop();
    const second = setup(async () => {
      calls++;
      return resource(rss);
    }, directory);
    const retried = await second.discovery.search(
      owner.id,
      discoverySearchRequestSchema.parse({}),
    );
    expect(retried.outcomes[0]).toMatchObject({
      status: 'rate_limited',
      retryAt: result.outcomes[0]!.retryAt,
    });
    expect(calls).toBe(1);
    expect(second.discovery.scans(owner.id)).toHaveLength(2);
  });

  it('validates recommendations and preserves triage and project isolation after rescans and restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paperloop-triage-'));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const first = setup(async () => resource(rss), directory);
    const owner = project(first);
    const other = project(first);
    first.discovery.selectSources(
      owner.id,
      sourceSelectionSchema.parse({
        feeds: [{ name: 'Engineering', url: 'https://example.com/feed' }],
      }),
    );
    const scan = await first.discovery.search(
      owner.id,
      discoverySearchRequestSchema.parse({}),
    );
    const id = scan.documentIds[0]!;
    expect(
      first.discovery.pendingAnalysis(owner.id, {
        query: '',
        offset: 0,
        limit: 10,
      }),
    ).toHaveLength(2);
    const invalid = await first.inject({
      headers,
      method: 'POST',
      url: `/api/v1/projects/${owner.id}/recommendations`,
      payload: { ...proposal(id), uncertainty: '', sources: [] },
    });
    expect(invalid.statusCode).toBe(400);
    const created = await first.inject({
      headers,
      method: 'POST',
      url: `/api/v1/projects/${owner.id}/recommendations`,
      payload: proposal(id),
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().proposal.sources[0]).toHaveProperty(
      'sourceVersion',
      'v2',
    );
    const recommendationId = created.json().id as string;
    expect(() =>
      first.discovery.storeRecommendation(owner.id, {
        ...proposal(id),
        sources: [{ ...proposal(id).sources[0]!, sourceVersion: 'v1' }],
      }),
    ).toThrow('Read the current source version');
    const dismissed = await first.inject({
      headers,
      method: 'PATCH',
      url: `/api/v1/projects/${owner.id}/recommendations/${recommendationId}`,
      payload: { state: 'dismissed', reason: 'Outside current scope' },
    });
    expect(dismissed.json()).toMatchObject({
      state: 'dismissed',
      reason: 'Outside current scope',
    });
    const otherView = await first.inject({
      headers,
      method: 'PATCH',
      url: `/api/v1/projects/${other.id}/recommendations/${recommendationId}`,
      payload: { state: 'saved' },
    });
    expect(otherView.statusCode).toBe(404);
    const otherSource = await first.inject({
      headers,
      method: 'POST',
      url: `/api/v1/projects/${other.id}/recommendations`,
      payload: proposal(id),
    });
    expect(otherSource.statusCode).toBe(404);
    await first.discovery.search(
      owner.id,
      discoverySearchRequestSchema.parse({}),
    );
    expect(
      first.discovery.storeRecommendation(owner.id, {
        ...proposal(id),
        summary: 'New analysis',
      }),
    ).toMatchObject({
      id: recommendationId,
      revision: 2,
      state: 'dismissed',
      reason: 'Outside current scope',
    });
    first.projects.update(owner.id, { description: 'Changed objective' });
    expect(() =>
      first.discovery.storeRecommendation(owner.id, proposal(id)),
    ).toThrow('Refresh project context');
    await first.close();
    cleanup.pop();
    const second = setup(async () => resource(rss), directory);
    expect(second.discovery.recommendations(owner.id)).toMatchObject([
      {
        id: recommendationId,
        state: 'dismissed',
        reason: 'Outside current scope',
        revision: 2,
      },
    ]);
    expect(
      second.discovery.triageHistory(owner.id, recommendationId),
    ).toMatchObject([{ state: 'dismissed', reason: 'Outside current scope' }]);
    expect(
      second.discovery.pendingAnalysis(owner.id, {
        query: '',
        offset: 0,
        limit: 10,
      }),
    ).toHaveLength(1);
    expect(second.discovery.sources(owner.id).selection.feeds).toHaveLength(1);
    for (const state of ['saved', 'tested', 'new'] as const)
      expect(
        second.discovery.triage(owner.id, recommendationId, {
          state,
          reason: 'Manual decision',
        }).state,
      ).toBe(state);
    const badEvidence = await second.inject({
      headers,
      method: 'PATCH',
      url: `/api/v1/projects/${owner.id}/recommendations/${recommendationId}`,
      payload: { state: 'tested', experimentId: recommendationId },
    });
    expect(badEvidence.statusCode).toBe(400);
  });

  it('exposes discovery and structured recommendations through a real MCP client', async () => {
    const app = setup(async () => resource(rss));
    const owner = project(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const client = new Client({ name: 'discovery-test', version: '1.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${address}/mcp`),
      { requestInit: { headers } },
    );
    await client.connect(transport as unknown as Transport);
    cleanup.push(() => client.close());
    const selected = await client.callTool({
      name: 'research_select_sources',
      arguments: {
        projectId: owner.id,
        selection: {
          feeds: [{ name: 'Engineering', url: 'https://example.com/feed' }],
        },
      },
    });
    expect(selected.isError).not.toBe(true);
    const scanned = await client.callTool({
      name: 'research_search',
      arguments: { projectId: owner.id, search: {} },
    });
    expect(scanned.isError).not.toBe(true);
    expect(scanned.structuredContent).toMatchObject({
      analysisStatus: 'waiting_for_agent',
    });
    const documentId = (scanned.structuredContent as { documentIds: string[] })
      .documentIds[0]!;
    const recommended = await client.callTool({
      name: 'research_store_recommendation',
      arguments: { projectId: owner.id, recommendation: proposal(documentId) },
    });
    expect(recommended.isError).not.toBe(true);
    const recommendationId = (recommended.structuredContent as { id: string })
      .id;
    const triaged = await client.callTool({
      name: 'research_triage',
      arguments: {
        projectId: owner.id,
        recommendationId,
        triage: { state: 'saved', reason: 'Evaluate next' },
      },
    });
    expect(triaged.structuredContent).toMatchObject({
      state: 'saved',
      reason: 'Evaluate next',
    });
    const library = await client.callTool({
      name: 'research_library_search',
      arguments: { search: { query: 'ranking' } },
    });
    expect(library.isError).not.toBe(true);
    expect(library.structuredContent).toMatchObject({
      documents: [{ id: documentId }],
    });
  });
});

describe('document library and extraction', () => {
  it('upgrades existing v4 research content into FTS and retained versions with a recoverable backup', () => {
    const dataDirectory = mkdtempSync(
      join(tmpdir(), 'paperloop-discovery-upgrade-'),
    );
    const migrationsFolder = mkdtempSync(
      join(tmpdir(), 'paperloop-discovery-old-migrations-'),
    );
    cleanup.push(() => rmSync(dataDirectory, { recursive: true, force: true }));
    cleanup.push(() =>
      rmSync(migrationsFolder, { recursive: true, force: true }),
    );
    mkdirSync(join(migrationsFolder, 'meta'));
    const journal = JSON.parse(
      readFileSync(
        new URL('../../drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.slice(0, 4);
    writeFileSync(
      join(migrationsFolder, 'meta/_journal.json'),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      copyFileSync(
        new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url),
        join(migrationsFolder, `${entry.tag}.sql`),
      );
    const database = new Database(join(dataDirectory, 'paperloop.sqlite'));
    migrate(drizzle(database), { migrationsFolder });
    const documentId = '00000000-0000-4000-8000-000000000001';
    const reference = `research/${documentId}/extracted.txt`;
    mkdirSync(join(dataDirectory, 'research', documentId), { recursive: true });
    writeFileSync(
      join(dataDirectory, reference),
      'Legacyfulltext retained content.',
    );
    database
      .prepare(
        `INSERT INTO research_documents (id, title, source_kind, source_reference, authors, extraction_status, extracted_content_reference, created_at, updated_at) VALUES (?, 'Legacy paper', 'reference', 'Existing citation', '[]', 'complete', ?, 0, 0)`,
      )
      .run(documentId, reference);
    const missingId = '00000000-0000-4000-8000-000000000002';
    database
      .prepare(
        `INSERT INTO research_documents (id, title, source_kind, source_reference, authors, extraction_status, extracted_content_reference, created_at, updated_at) VALUES (?, 'Missing artifact', 'reference', 'Missing citation', '[]', 'complete', 'research/missing.txt', 0, 0)`,
      )
      .run(missingId);
    database.close();
    const app = setup(undefined, dataDirectory);
    const owner = project(app);
    expect(app.database.sqlite.pragma('user_version', { simple: true })).toBe(
      SUPPORTED_SCHEMA_VERSION,
    );
    const backup = new Database(app.database.backupPath!, { readonly: true });
    expect(backup.pragma('user_version', { simple: true })).toBe(4);
    expect(
      backup.prepare('SELECT title FROM research_documents').pluck().get(),
    ).toBe('Legacy paper');
    backup.close();
    expect(
      app.research.searchLibrary({
        query: 'Legacyfulltext',
        offset: 0,
        limit: 20,
      }).documents[0]!.id,
    ).toBe(documentId);
    app.research.attach(owner.id, missingId);
    expect(app.research.get(owner.id, missingId)).toMatchObject({
      extractionStatus: 'failed',
      extractedContentAvailable: false,
    });
    expect(app.research.get(owner.id, missingId).extractionError).toContain(
      'restore the document artifact',
    );
    app.research.attach(owner.id, documentId);
    const version = app.research.versions(owner.id, documentId)[0]!;
    expect(version.contentAvailable).toBe(true);
    expect(
      app.research.readContent(owner.id, documentId, {
        offset: 0,
        limit: 200,
        versionId: version.id,
      }).content,
    ).toContain('Legacyfulltext');
  });

  it('extracts text PDFs, records missing text without OCR, and marks mixed pages partial', async () => {
    const pdfResource = (pages: string[]) => ({
      url: 'https://example.com/paper.pdf',
      contentType: 'application/pdf',
      body: makePdf(pages),
    });
    const complete = await extractResource(
      pdfResource(['Ranking evidence from a text PDF.']),
    );
    expect(complete).toMatchObject({ status: 'complete' });
    expect(complete.content).toContain('Ranking evidence');
    const scanned = await extractResource(pdfResource(['']));
    expect(scanned).toMatchObject({ status: 'unavailable' });
    expect(scanned.error).toContain('OCR is not supported');
    const mixed = await extractResource(pdfResource(['A readable page.', '']));
    expect(mixed).toMatchObject({ status: 'partial' });
    expect(mixed.content).toContain('A readable page.');
  });

  it('normalizes arXiv URLs and IDs, retains version text, avoids downgrades, and searches shared FTS independently of project state', async () => {
    const app = setup();
    const owner = project(app);
    const other = project(app);
    const v1 = app.research.ingest(owner.id, {
      title: 'Original',
      sourceKind: 'url',
      sourceReference: 'https://arxiv.org/pdf/2401.01234v1.pdf#page=1',
      authors: ['Ada'],
      extractionStatus: 'complete',
      extractedContent: 'Uniquequasar ranking results.',
      submittedBy: 'user',
    });
    const v2 = app.research.ingest(other.id, {
      title: 'Revised',
      sourceKind: 'arxiv',
      sourceReference: 'arXiv:2401.01234v2',
      authors: ['Ada'],
      extractionStatus: 'complete',
      extractedContent: 'Improved nebula ranking.',
      submittedBy: 'agent',
    });
    expect(v1.id).toBe(v2.id);
    expect(app.research.versions(owner.id, v1.id)).toHaveLength(2);
    const version = app.research
      .versions(owner.id, v1.id)
      .find((item) => item.sourceVersion === 'v1')!;
    expect(
      app.research.readContent(owner.id, v1.id, {
        offset: 0,
        limit: 12,
        versionId: version.id,
      }).content,
    ).toBe('Uniquequasar');
    app.research.ingest(owner.id, {
      title: 'Abstract',
      sourceKind: 'arxiv',
      sourceReference: '2401.01234v2',
      authors: [],
      extractionStatus: 'partial',
      extractedContent: 'Only abstract.',
      submittedBy: 'agent',
    });
    expect(app.research.get(owner.id, v1.id).extractionStatus).toBe('complete');
    expect(
      app.research.readContent(owner.id, v1.id, { offset: 0, limit: 100 })
        .content,
    ).toBe('Improved nebula ranking.');
    app.research.ingest(owner.id, {
      title: 'Older',
      sourceKind: 'arxiv',
      sourceReference: '2401.01234v1',
      authors: [],
      extractionStatus: 'complete',
      extractedContent: 'Older text.',
      submittedBy: 'agent',
    });
    expect(
      app.research
        .versions(owner.id, v1.id)
        .some((version) => version.sourceVersion === 'v1'),
    ).toBe(true);
    expect(
      app.research.searchLibrary({ query: 'Ada', offset: 0, limit: 10 })
        .documents,
    ).toHaveLength(1);
    expect(app.research.get(owner.id, v1.id)).toMatchObject({
      title: 'Abstract',
      sourceVersion: 'v2',
    });
    expect(
      app.research.searchLibrary({ query: 'nebula', offset: 0, limit: 1 }),
    ).toMatchObject({ documents: [{ id: v1.id }], nextOffset: null });
    expect(
      app.research.searchLibrary({ query: '" OR *', offset: 0, limit: 1 })
        .documents,
    ).toEqual([]);
    const clean = app.research.ingest(owner.id, {
      title: 'Cache',
      sourceKind: 'url',
      sourceReference: 'https://example.com/cache?a=1&utm_campaign=foo#section',
      authors: [],
      extractionStatus: 'pending',
      submittedBy: 'user',
    });
    expect(clean.sourceReference).toBe('https://example.com/cache?a=1');
    const third = project(app);
    expect(
      app.research.searchLibrary(
        { query: 'nebula', offset: 0, limit: 20 },
        third.id,
      ).documents,
    ).toEqual([]);
    app.research.attach(third.id, v1.id);
    expect(app.research.get(third.id, v1.id).currentBrief).toBeNull();
    expect(
      app.research.searchLibrary({ query: '', offset: 0, limit: 1 }).nextOffset,
    ).toBe(1);
    const oversized = await app.inject({
      headers,
      method: 'GET',
      url: `/api/v1/projects/${owner.id}/research/${v1.id}/content?limit=20001`,
    });
    expect(oversized.statusCode).toBe(400);
  });

  it('extracts inert HTML and plain text, records failed downloads and unsupported extraction', async () => {
    const html =
      '<html><head><title>Useful article</title></head><body><article><h1>Useful article</h1><p>' +
      'Retrieval ranking improves query results. '.repeat(60) +
      '</p><script>throw new Error("must never run")</script></article></body></html>';
    const extracted = await extractResource(resource(html, 'text/html'));
    expect(extracted).toMatchObject({
      status: 'complete',
      title: 'Useful article',
    });
    expect(extracted.content).not.toContain('must never run');
    expect(await extractResource(resource('plain text', 'text/plain'))).toEqual(
      { status: 'complete', content: 'plain text' },
    );
    expect(
      await extractResource(resource('binary', 'application/octet-stream')),
    ).toMatchObject({ status: 'unavailable' });
    expect(
      await extractResource(resource('%PDF-broken', 'application/pdf')),
    ).toMatchObject({ status: 'failed' });
    const app = setup(async (url) => {
      if (url.includes('failure')) throw new Error('Timed out');
      return resource(html, 'text/html', url);
    });
    const owner = project(app);
    const successful = await app.inject({
      headers,
      method: 'POST',
      url: `/api/v1/projects/${owner.id}/research/fetch`,
      payload: { url: 'https://example.com/article' },
    });
    expect(successful.statusCode).toBe(200);
    expect(successful.json()).toMatchObject({
      extractionStatus: 'complete',
      extractedContentAvailable: true,
    });
    expect(
      app.research.searchLibrary({ query: 'ranking', offset: 0, limit: 20 })
        .documents,
    ).toHaveLength(1);
    const failed = await app.discovery.fetchUrl(
      owner.id,
      'https://example.com/failure',
    );
    expect(failed).toMatchObject({
      extractionStatus: 'failed',
      extractionError: 'Timed out',
    });
  });

  it('parses RSS and Atom and rejects malformed XML, external entities, invalid URLs, and private destinations', async () => {
    const source = sourceCatalog.sources.find(
      (item) => item.id === 'arxiv-ir',
    )!;
    let requestUrl = '';
    const page = await searchSource(
      source,
      'ranking" OR secret',
      10,
      1,
      async (url) => {
        requestUrl = url;
        return resource(atom);
      },
    );
    expect(new URL(requestUrl).searchParams.get('start')).toBe('10');
    expect(new URL(requestUrl).searchParams.get('search_query')).toBe(
      '(cat:cs.IR) AND all:"ranking  OR secret"',
    );
    expect(page.documents[0]).toMatchObject({
      title: 'Retrieval study',
      authors: ['Ada'],
    });
    await expect(
      searchSource(source, '', 0, 1, async () =>
        resource(
          '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed/>',
        ),
      ),
    ).rejects.toThrow('supported XML');
    await expect(
      searchSource(source, '', 0, 1, async () => resource('<feed><entry>')),
    ).rejects.toThrow('supported XML');
    const feed = {
      id: 'atom',
      name: 'Atom',
      kind: 'feed' as const,
      url: 'https://example.com/feed',
      coverage: 'Available feed',
    };
    const atomFeed = await searchSource(feed, 'ranking', 0, 1, async () =>
      resource(
        '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Ranking</title><link rel="alternate" href="https://example.com/ranking"/><summary>Methods</summary></entry></feed>',
      ),
    );
    expect(atomFeed.documents[0]!.sourceReference).toBe(
      'https://example.com/ranking',
    );
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '10.0.0.1',
      '169.254.169.254',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
    ])
      expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://example.com:3000/x',
      'file:///etc/passwd',
      'https://user:secret@example.com',
    ])
      expect(() => validatePublicUrl(url)).toThrow();
  });
});

// Minimal valid PDF fixtures with exact byte offsets; no remote downloads or native writer needed.
function makePdf(pages: string[]): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const text of pages) {
    const contentId = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const stream = text ? `BT /F1 12 Tf 20 200 Td (${text}) Tj ET` : '';
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
