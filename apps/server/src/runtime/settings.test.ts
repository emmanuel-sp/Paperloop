import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createProbeExecutor } from '../analysis/provider-probe.js';
const headers = { authorization: 'Bearer settings-test' };
async function fixture(keyAvailable = true) {
  const probeExecutor = vi
    .fn()
    .mockResolvedValue({ inputTokens: 8, outputTokens: 1 });
  const modelExecutor = vi
    .fn()
    .mockResolvedValue({ recommendations: [], plans: [] });
  const app = createApp({
    logger: false,
    connectionSecret: 'settings-test',
    probeExecutor,
    modelExecutor,
    settingsEnvironment: keyAvailable
      ? { OPENAI_API_KEY: 'fixture-only-secret-value' }
      : {},
    storage: {
      dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-settings-')),
    },
  });
  const project = app.projects.create({
    name: 'Settings fixture',
    description: 'Settings',
    objectives: [],
    constraints: [],
  });
  const session = await app.inject({
    method: 'POST',
    url: '/api/v1/session',
    headers,
  });
  const cookie = {
    cookie: String(session.headers['set-cookie']).split(';')[0]!,
  };
  const test = (requestId = randomUUID(), model = 'fixture-model') =>
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/analysis/test/approve`,
      headers: cookie,
      payload: { provider: 'openai', model, consent: true, requestId },
    });
  return { app, project, probeExecutor, modelExecutor, cookie, test };
}
describe('shared Settings and explicit bounded activation', () => {
  it('persists detected preferences and never resets a saved timezone on another browser initialization', async () => {
    const { app } = await fixture();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/preferences/initialize',
        headers,
        payload: { timezone: 'America/Los_Angeles' },
      });
      expect(first.json()).toMatchObject({
        timezone: 'America/Los_Angeles',
        driver: 'native',
      });
      await app.inject({
        method: 'PUT',
        url: '/api/v1/preferences',
        headers,
        payload: {
          timezone: 'Europe/London',
          mechanism: 'claude-session',
          provider: 'anthropic',
          driver: 'native',
        },
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/preferences/initialize',
            headers,
            payload: { timezone: 'UTC' },
          })
        ).json(),
      ).toMatchObject({
        timezone: 'Europe/London',
        mechanism: 'claude-session',
        provider: 'anthropic',
      });
    } finally {
      await app.close();
    }
  });
  it('reports credential availability without revealing values or calling a provider', async () => {
    const { app, project, probeExecutor } = await fixture();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${project.id}/settings`,
        headers,
      });
      expect(response.json().providers[0]).toMatchObject({
        keyAvailable: true,
        probe: null,
      });
      expect(response.body).not.toContain('fixture-only-secret-value');
      expect(response.json().connection.toolsListedAt).toBeNull();
      expect(probeExecutor).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('requires browser consent, caches each paid request, and keeps activation separate', async () => {
    const { app, project, cookie, probeExecutor, test } = await fixture();
    try {
      const enable = () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/projects/${project.id}/analysis/approve`,
          headers: cookie,
          payload: {
            provider: 'openai',
            model: 'fixture-model',
            enabled: true,
          },
        });
      expect((await enable()).statusCode).toBe(409);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/projects/${project.id}/analysis/test/approve`,
            headers,
            payload: {
              provider: 'openai',
              model: 'fixture-model',
              consent: true,
              requestId: randomUUID(),
            },
          })
        ).statusCode,
      ).toBe(403);
      const requestId = randomUUID();
      expect((await test(requestId)).json()).toMatchObject({
        status: 'succeeded',
        inputTokens: 8,
        outputTokens: 1,
        costUsd: null,
      });
      expect(app.analysis.settings(project.id)).toHaveLength(0);
      expect((await test(requestId)).json().status).toBe('succeeded');
      expect(probeExecutor).toHaveBeenCalledTimes(1);
      expect((await enable()).statusCode).toBe(200);
      expect((await test(requestId, 'different-model')).statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('handles missing keys and failures without retries and enforces daily analysis call limits', async () => {
    const missing = await fixture(false);
    try {
      expect((await missing.test()).statusCode).toBe(400);
      expect(missing.probeExecutor).not.toHaveBeenCalled();
    } finally {
      await missing.app.close();
    }
    const { app, project, probeExecutor, modelExecutor, test } =
      await fixture();
    try {
      probeExecutor.mockRejectedValue(new Error('sensitive provider details'));
      const failed = await test();
      expect(failed.json().status).toBe('failed');
      expect(failed.body).not.toContain('sensitive provider details');
      expect(probeExecutor).toHaveBeenCalledTimes(1);
      app.analysis.activate(project.id, {
        provider: 'openai',
        model: 'fixture-model',
        enabled: true,
        dailyCallLimit: 1,
        maxOutputTokens: 128,
      });
      await app.analysis.analyze(
        project.id,
        'openai',
        [],
        new AbortController().signal,
      );
      await expect(
        app.analysis.analyze(
          project.id,
          'openai',
          [],
          new AbortController().signal,
        ),
      ).rejects.toThrow(/daily paid-call limit/);
      expect(modelExecutor).toHaveBeenCalledTimes(1);
      expect(modelExecutor.mock.calls[0]![0].maxOutputTokens).toBe(128);
    } finally {
      await app.close();
    }
  });
  it('distinguishes authenticated client initialization and tool discovery from service health', async () => {
    const { app, project } = await fixture();
    const client = new Client({
      name: 'configured-coding-client',
      version: '1',
    });
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const transport = new StreamableHTTPClientTransport(
        new URL(`${address}/mcp`),
        { requestInit: { headers } },
      );
      await client.connect(transport as unknown as Transport);
      await client.listTools();
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${project.id}/settings`,
        headers,
      });
      expect(response.json().connection).toMatchObject({
        client: 'configured-coding-client',
        initializedAt: expect.any(String),
        toolsListedAt: expect.any(String),
      });
    } finally {
      await client.close();
      await app.close();
    }
  });
  it('bounds provider test output and reports usage without applying model output', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [{ content: [{ type: 'output_text', text: 'OK' }] }],
            usage: { input_tokens: 3, output_tokens: 1 },
          }),
        ),
      );
    const probe = createProbeExecutor(
      { OPENAI_API_KEY: 'fixture-key' },
      fetcher,
    );
    expect(
      await probe({
        provider: 'openai',
        model: 'fixture-model',
        signal: new AbortController().signal,
      }),
    ).toEqual({ inputTokens: 3, outputTokens: 1 });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).max_output_tokens).toBe(
      32,
    );
  });
});
