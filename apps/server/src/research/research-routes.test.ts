import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const authorization = { authorization: 'Bearer test-local-secret' };

function makeApp(dataDirectory = mkdtempSync(join(tmpdir(), 'paperloop-research-'))) {
  return createApp({
    connectionSecret: 'test-local-secret',
    logger: false,
    storage: { dataDirectory },
  });
}

async function createProject(app: ReturnType<typeof createApp>) {
  const response = await app.inject({
    headers: authorization,
    method: 'POST',
    url: '/api/v1/projects',
    payload: {
      name: 'Research project',
      description: 'A project used to test supplied research ingestion.',
    },
  });
  return response.json() as { id: string };
}

describe('research routes', () => {
  it('persists supplied content, provenance, and a versioned brief across restart', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'paperloop-research-restart-'));
    const firstApp = makeApp(dataDirectory);
    const project = await createProject(firstApp);
    const ingested = await firstApp.inject({
      headers: authorization,
      method: 'POST',
      url: `/api/v1/projects/${project.id}/research`,
      payload: {
        title: 'Attention Is All You Need',
        sourceKind: 'url',
        sourceReference: 'https://example.com/paper#abstract',
        canonicalUrl: 'https://example.com/paper',
        authors: ['Researcher One'],
        sourceVersion: 'v2',
        extractionStatus: 'partial',
        extractedContent: 'An available excerpt from the supplied paper.',
        submittedBy: 'user',
        retrievedAt: '2026-09-29T12:00:00.000Z',
      },
    });

    expect(ingested.statusCode).toBe(201);
    expect(ingested.json()).toMatchObject({
      sourceReference: 'https://example.com/paper',
      extractionStatus: 'partial',
      extractedContentAvailable: true,
      currentBrief: null,
    });

    const documentId = ingested.json().id as string;
    const content = await firstApp.inject({
      headers: authorization,
      method: 'GET',
      url: `/api/v1/projects/${project.id}/research/${documentId}/content?offset=3&limit=12`,
    });
    expect(content.statusCode).toBe(200);
    expect(content.json()).toEqual({
      documentId,
      content: 'available ex',
      offset: 3,
      nextOffset: 15,
      totalLength: 45,
    });
    const brief = await firstApp.inject({
      headers: authorization,
      method: 'POST',
      url: `/api/v1/projects/${project.id}/research/${documentId}/briefs`,
      payload: {
        summary: 'Use attention to improve sequence handling.',
        applicability: 'The project processes ordered source material.',
        proposedChanges: ['Add an attention-backed candidate implementation.'],
        risks: ['Memory use may increase.'],
        evaluationIdeas: ['Compare latency and answer quality.'],
        sourceClaims: [
          { claim: 'Attention can model dependencies.', evidence: 'Supplied excerpt.' },
        ],
      },
    });
    expect(brief.statusCode).toBe(201);
    expect(brief.json()).toMatchObject({
      currentBrief: { version: 1, summary: 'Use attention to improve sequence handling.' },
    });
    await firstApp.close();

    const restartedApp = makeApp(dataDirectory);
    const listed = await restartedApp.inject({
      headers: authorization,
      method: 'GET',
      url: `/api/v1/projects/${project.id}/research`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().documents).toHaveLength(1);
    expect(listed.json().documents[0]).toMatchObject({
      id: documentId,
      sourceVersion: 'v2',
      currentBrief: { version: 1 },
    });
    await restartedApp.close();
  });

  it('deduplicates source identity while preserving per-project briefs', async () => {
    const app = makeApp();
    const firstProject = await createProject(app);
    const secondProject = await createProject(app);
    const payload = {
      title: 'Shared paper',
      sourceKind: 'arxiv',
      sourceReference: '2401.01234',
      extractionStatus: 'pending',
    };
    const first = await app.inject({
      headers: authorization,
      method: 'POST',
      url: `/api/v1/projects/${firstProject.id}/research`,
      payload,
    });
    const second = await app.inject({
      headers: authorization,
      method: 'POST',
      url: `/api/v1/projects/${secondProject.id}/research`,
      payload: { ...payload, submittedBy: 'agent' },
    });

    expect(second.json().id).toBe(first.json().id);
    const documentId = first.json().id as string;
    await app.inject({
      headers: authorization,
      method: 'POST',
      url: `/api/v1/projects/${firstProject.id}/research/${documentId}/briefs`,
      payload: {
        summary: 'Only for the first project.',
        applicability: 'Project-specific reasoning.',
      },
    });
    const secondView = await app.inject({
      headers: authorization,
      method: 'GET',
      url: `/api/v1/projects/${secondProject.id}/research/${documentId}`,
    });
    expect(secondView.json().currentBrief).toBeNull();
    await app.close();
  });

  it('validates extraction evidence and project membership', async () => {
    const app = makeApp();
    const project = await createProject(app);
    const invalid = await app.inject({
      headers: authorization,
      method: 'POST',
      url: `/api/v1/projects/${project.id}/research`,
      payload: {
        title: 'Missing content',
        sourceKind: 'url',
        sourceReference: 'https://example.com/missing',
        extractionStatus: 'complete',
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const missing = await app.inject({
      headers: authorization,
      method: 'GET',
      url: `/api/v1/projects/${project.id}/research/00000000-0000-4000-8000-000000000000`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      code: 'RESEARCH_DOCUMENT_NOT_FOUND',
    });
    await app.close();
  });
});
