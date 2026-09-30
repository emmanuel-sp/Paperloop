import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(closeCallbacks.splice(0).map((close) => close()));
});

describe('project MCP endpoint', () => {
  it('exposes shared project services to an authenticated MCP client', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'paperloop-mcp-test-'));
    const connectionSecret = 'test-local-secret';
    const app = createApp({
      connectionSecret,
      logger: false,
      storage: { dataDirectory },
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    closeCallbacks.push(() => app.close());

    const client = new Client({ name: 'paperloop-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${connectionSecret}` },
      },
    });
    await client.connect(transport as unknown as Transport);
    closeCallbacks.push(() => client.close());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'projects_list',
      'projects_get',
      'projects_create',
      'projects_update',
      'projects_register_repository',
      'projects_refresh_context',
      'projects_context_history',
      'research_list',
      'research_get',
      'research_read_content',
      'research_ingest',
      'research_store_implementation_brief',
      'evaluations_list',
      'evaluations_draft',
      'evaluations_get',
      'implement_paper',
      'experiments_list',
      'experiments_get',
      'experiments_claim',
      'experiments_progress',
      'experiments_reconcile',
      'evaluations_run',
      'evaluations_run_get',
      'evaluations_cancel',
      'evaluations_external_result',
      'experiments_compare',
      'evaluations_artifact',
    ]);

    const created = await client.callTool({
      name: 'projects_create',
      arguments: {
        name: 'MCP verified project',
        description: 'Created through the official MCP client.',
        objectives: ['Share one durable project context'],
        constraints: ['Keep credentials separate'],
      },
    });
    expect(created.isError).not.toBe(true);
    expect(created.structuredContent).toMatchObject({
      name: 'MCP verified project',
      currentContext: { version: 1 },
    });

    const projectId = (created.structuredContent as { id: string }).id;
    const updated = await client.callTool({
      name: 'projects_update',
      arguments: {
        projectId,
        changes: { objectives: ['Keep the UI and agents aligned'] },
      },
    });
    expect(updated.structuredContent).toMatchObject({
      id: projectId,
      currentContext: { version: 2 },
    });

    const listed = await client.callTool({
      name: 'projects_list',
      arguments: {},
    });
    expect(listed.structuredContent).toMatchObject({
      projects: [{ id: projectId, name: 'MCP verified project' }],
    });

    const history = await client.callTool({
      name: 'projects_context_history',
      arguments: { projectId },
    });
    expect(history.structuredContent).toMatchObject({
      contexts: [{ version: 2 }, { version: 1 }],
    });

    const paper = await client.callTool({
      name: 'research_ingest',
      arguments: {
        projectId,
        document: {
          title: 'A supplied paper',
          sourceKind: 'reference',
          sourceReference: 'Doe et al. (2026)',
          extractionStatus: 'complete',
          extractedContent: 'Persisted source content.',
          submittedBy: 'agent',
        },
      },
    });
    expect(paper.isError).not.toBe(true);
    expect(paper.structuredContent).toMatchObject({
      projectId,
      extractionStatus: 'complete',
    });
    const documentId = (paper.structuredContent as { id: string }).id;
    const content = await client.callTool({
      name: 'research_read_content',
      arguments: { projectId, documentId, page: { offset: 0, limit: 10 } },
    });
    expect(content.structuredContent).toMatchObject({
      documentId,
      content: 'Persisted ',
      offset: 0,
      nextOffset: 10,
      totalLength: 25,
    });

    const brief = await client.callTool({
      name: 'research_store_implementation_brief',
      arguments: {
        projectId,
        documentId,
        brief: {
          summary: 'Apply the supplied technique.',
          applicability: 'It aligns with the project objective.',
          proposedChanges: ['Build one isolated candidate.'],
          risks: [],
          evaluationIdeas: ['Compare the existing and candidate paths.'],
          sourceClaims: [],
        },
      },
    });
    expect(brief.structuredContent).toMatchObject({
      id: documentId,
      currentBrief: { version: 1 },
    });
  });

  it('rejects MCP requests without the local connection secret', async () => {
    const app = createApp({
      connectionSecret: 'test-local-secret',
      logger: false,
      storage: {
        dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-mcp-auth-test-')),
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'unauthenticated-test', version: '1.0.0' },
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    await app.close();
  });
});
