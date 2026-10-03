import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { PublicFetcher } from './public-fetch.js';
const headers = { authorization: 'Bearer import-test' };
const fetcher: PublicFetcher = async (url) => {
  if (url.includes('crossref'))
    return {
      url,
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          message: {
            title: ['Resolved DOI title'],
            author: [{ given: 'Ada', family: 'Lovelace' }],
          },
        }),
      ),
    };
  if (url.includes('export.arxiv'))
    return {
      url,
      contentType: 'application/atom+xml',
      body: Buffer.from(
        '<feed><entry><title>Versioned research</title><author><name>A Researcher</name></author><summary>Available abstract.</summary></entry></feed>',
      ),
    };
  if (url.includes('unavailable')) throw new Error('Source returned HTTP 403.');
  return {
    url,
    contentType: 'text/html',
    body: Buffer.from(
      '<html><head><title>Article</title><meta name="citation_title" content="Inferred article"><meta name="citation_author" content="An Author"></head><body><article><p>' +
        'Research evidence and useful details. '.repeat(30) +
        '</p></article></body></html>',
    ),
  };
};
async function fixture() {
  const app = createApp({
    logger: false,
    connectionSecret: 'import-test',
    researchFetcher: fetcher,
    storage: {
      dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-import-')),
    },
  });
  const project = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: { name: 'Import', description: 'Import evidence' },
    })
  ).json() as { id: string };
  const post = (suffix: string, payload: Record<string, unknown>, projectId = project.id) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/research/import/${suffix}`,
      headers,
      payload,
    });
  return { app, project, post };
}
describe('broad research import', () => {
  it('previews without saving, resolves metadata, and deduplicates canonical URLs', async () => {
    const { app, project, post } = await fixture();
    try {
      const preview = await post('preview', {
        input: 'https://example.org/paper?utm_source=test#abstract',
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({
        inputKind: 'url',
        document: {
          title: 'Inferred article',
          authors: ['An Author'],
          sourceReference: 'https://example.org/paper',
          extractionStatus: 'complete',
        },
        duplicateId: null,
      });
      expect(app.research.list(project.id)).toHaveLength(0);
      const saved = await post('commit', {
        previewId: preview.json().id,
        title: 'Corrected title',
      });
      expect(saved.statusCode).toBe(201);
      expect(saved.json().importNotes).toContain('Input type: url');
      const duplicate = await post('preview', {
        input: 'https://example.org/paper',
      });
      expect(duplicate.json().duplicateId).toBe(saved.json().id);
      expect(
        (await post('commit', { previewId: duplicate.json().id })).json().id,
      ).toBe(saved.json().id);
      expect(app.research.list(project.id)).toHaveLength(1);
      expect(
        (await post('commit', { previewId: preview.json().id })).statusCode,
      ).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('resolves DOI and arXiv metadata while preserving explicit versions', async () => {
    const { app, post } = await fixture();
    try {
      expect(
        (await post('preview', { input: 'doi:10.1234/example' })).json(),
      ).toMatchObject({
        inputKind: 'doi',
        document: {
          title: 'Resolved DOI title',
          authors: ['Ada Lovelace'],
          canonicalUrl: 'https://doi.org/10.1234/example',
        },
      });
      expect(
        (
          await post('preview', {
            input: 'https://arxiv.org/pdf/2401.12345v2.pdf',
          })
        ).json(),
      ).toMatchObject({
        inputKind: 'arxiv',
        document: {
          title: 'Versioned research',
          sourceReference: '2401.12345',
          sourceVersion: 'v2',
          authors: ['A Researcher'],
        },
      });
    } finally {
      await app.close();
    }
  });
  it('preserves text, file identity, unavailable extraction and correction fallback', async () => {
    const { app, post } = await fixture();
    try {
      const text = 'A supplied paper\nEvidence without paid inference.';
      const pasted = await post('preview', { input: text });
      expect(pasted.json()).toMatchObject({
        inputKind: 'text',
        document: { title: 'A supplied paper', extractedContent: text },
      });
      const file = await post('preview', {
        file: {
          name: 'paper.txt',
          contentType: 'text/plain',
          data: Buffer.from(text).toString('base64'),
        },
      });
      expect(file.json()).toMatchObject({
        inputKind: 'file',
        document: { extractedContent: text, extractionStatus: 'complete' },
      });
      expect(file.json().document.sourceReference).toMatch(/^file:sha256:/);
      const unavailable = await post('preview', {
        input: 'https://unavailable.example/paper',
      });
      expect(unavailable.json().document).toMatchObject({
        extractionStatus: 'failed',
        extractionError: 'Source returned HTTP 403.',
      });
      expect(
        (
          await post('commit', {
            previewId: unavailable.json().id,
            extractedContent: text,
          })
        ).json(),
      ).toMatchObject({ extractionStatus: 'complete', extractionError: null });
      const unsupported = await post('preview', {
        file: {
          name: 'image.png',
          contentType: 'image/png',
          data: Buffer.from('image').toString('base64'),
        },
      });
      expect(unsupported.json().document.extractionStatus).toBe('unavailable');
      expect(
        (
          await post('preview', {
            file: {
              name: 'large.txt',
              contentType: 'text/plain',
              data: Buffer.alloc(1024 * 1024 + 1).toString('base64'),
            },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it('rejects cross-project commits and preserves authenticated access', async () => {
    const { app, post } = await fixture();
    try {
      const preview = await post('preview', {
        input: 'Citation supplied by user',
      });
      const second = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers,
          payload: { name: 'Other', description: 'Other context' },
        })
      ).json() as { id: string };
      expect(
        (await post('commit', { previewId: preview.json().id }, second.id))
          .statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/projects/${second.id}/research/import/preview`,
            payload: { input: 'Citation' },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
