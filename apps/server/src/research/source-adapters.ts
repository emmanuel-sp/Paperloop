import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  IngestResearchDocumentRequest,
  ResearchSource,
} from '@paperloop/contracts';
import { publicUrlSchema } from '@paperloop/contracts';
import type { PublicFetcher } from './public-fetch.js';

interface FeedEntry {
  [key: string]: unknown;
}
export interface SourcePage {
  documents: IngestResearchDocumentRequest[];
  nextOffset: number | null;
}
function list(value: unknown): FeedEntry[] {
  return (Array.isArray(value) ? value : value ? [value] : []) as FeedEntry[];
}
function string(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (value && typeof value === 'object' && '#text' in value)
    return string(value['#text']);
  return '';
}
function clean(value: unknown): string {
  return string(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchSource(
  source: ResearchSource,
  query: string,
  offset: number,
  limit: number,
  fetcher: PublicFetcher,
): Promise<SourcePage> {
  let url = source.url!;
  if (source.kind === 'arxiv') {
    const api = new URL('https://export.arxiv.org/api/query');
    // User text is a literal phrase; collection expressions are trusted catalog data.
    const phrase = query.replace(/["\\]/g, ' ').trim();
    api.searchParams.set(
      'search_query',
      phrase ? `(${source.query}) AND all:"${phrase}"` : source.query!,
    );
    api.searchParams.set('start', String(offset));
    api.searchParams.set('max_results', String(limit));
    api.searchParams.set('sortBy', 'submittedDate');
    api.searchParams.set('sortOrder', 'descending');
    url = api.toString();
  }
  const resource = await fetcher(url);
  const xml = new TextDecoder().decode(resource.body);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('Source did not return a supported XML feed.');
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: true,
    parseTagValue: false,
  }).parse(xml) as {
    feed?: FeedEntry;
    rss?: { channel?: FeedEntry };
    RDF?: FeedEntry;
  };
  const root = parsed.feed ?? parsed.rss?.channel ?? parsed.RDF;
  if (!root) throw new Error('Expected an RSS or Atom feed.');
  const entries = list(root.entry ?? root.item).slice(
    0,
    source.kind === 'arxiv' ? limit : 200,
  );
  if (
    source.kind === 'arxiv' &&
    entries.some((entry) => string(entry.id).includes('/api/errors'))
  )
    throw new Error(clean(entries[0]?.summary) || 'arXiv rejected the query.');
  const documents: IngestResearchDocumentRequest[] = [];
  for (const entry of entries) {
    const links = list(entry.link);
    const link =
      typeof entry.link === 'string'
        ? entry.link
        : string(
            links.find(
              (item) => !item['@_rel'] || item['@_rel'] === 'alternate',
            )?.['@_href'],
          );
    const reference =
      source.kind === 'arxiv' ? string(entry.id) : link || string(entry.guid);
    const title = clean(entry.title).slice(0, 500);
    if (!title || !publicUrlSchema.safeParse(reference).success) continue;
    const summary = clean(
      entry.summary ?? entry.description ?? entry.encoded,
    ).slice(0, 100000);
    if (
      source.kind === 'feed' &&
      query &&
      !`${title} ${summary}`.toLowerCase().includes(query.toLowerCase())
    )
      continue;
    const version =
      source.kind === 'arxiv'
        ? /v\d+$/.exec(reference)?.[0]
        : clean(entry.updated ?? entry.pubDate) || undefined;
    documents.push({
      title,
      sourceKind: source.kind === 'arxiv' ? 'arxiv' : 'url',
      sourceReference: reference,
      canonicalUrl: reference,
      authors: list(entry.author)
        .map((item) => clean(item.name ?? item))
        .filter(Boolean)
        .slice(0, 100),
      ...(version ? { sourceVersion: version.slice(0, 200) } : {}),
      extractionStatus: summary ? 'partial' : 'pending',
      ...(summary ? { extractedContent: summary } : {}),
      submittedBy: 'agent',
      retrievedAt: new Date().toISOString(),
    });
  }
  const page =
    source.kind === 'arxiv'
      ? documents
      : documents.slice(offset, offset + limit);
  const total = Number(string(root.totalResults));
  const next =
    source.kind === 'arxiv'
      ? offset + entries.length < total
        ? offset + entries.length
        : null
      : offset + limit < documents.length
        ? offset + limit
        : null;
  return {
    documents: page,
    nextOffset:
      next !== null && next <= 10000 && entries.length > 0 ? next : null,
  };
}
