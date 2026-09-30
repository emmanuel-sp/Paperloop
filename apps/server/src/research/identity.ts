import type { IngestResearchDocumentRequest } from '@paperloop/contracts';
import { WorkflowError } from '../evaluations/plan-service.js';

export function normalizeIdentity(
  input: Pick<
    IngestResearchDocumentRequest,
    'sourceKind' | 'sourceReference' | 'sourceVersion'
  >,
) {
  let reference = input.sourceReference.trim();
  let kind = input.sourceKind;
  if (kind === 'url') {
    const url = new URL(reference);
    url.hash = '';
    if (
      ['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(
        url.hostname,
      ) &&
      /^\/(abs|pdf|html)\//.test(url.pathname)
    ) {
      reference = url.pathname
        .replace(/^\/(abs|pdf|html)\//, '')
        .replace(/\.pdf$/, '')
        .trim();
      kind = 'arxiv';
    } else {
      for (const key of [...url.searchParams.keys()]) {
        if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      reference = url.toString();
    }
  }
  let version = input.sourceVersion;
  if (kind === 'arxiv') {
    reference = reference
      .replace(/^arxiv:/i, '')
      .replace(/^https?:\/\/[^/]+\/(abs|pdf|html)\//i, '')
      .replace(/\.pdf$/, '')
      .trim();
    const match =
      /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/.exec(reference);
    if (!match)
      throw new WorkflowError(
        'INVALID_ARXIV_ID',
        'Supply a valid arXiv identifier or paper URL.',
        400,
      );
    reference = match[1]!;
    if (match[2]) version = match[2];
    if (version && !/^v[1-9]\d*$/.test(version))
      throw new WorkflowError(
        'INVALID_ARXIV_VERSION',
        'An arXiv version must be v followed by a positive integer.',
        400,
      );
  }
  return {
    sourceKind: kind,
    sourceReference: reference,
    sourceVersion: version,
  };
}
