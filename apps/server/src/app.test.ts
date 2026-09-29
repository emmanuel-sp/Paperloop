import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('health route', () => {
  it('returns the API health contract', async () => {
    const app = createApp({
      storage: {
        dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-app-test-')),
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

describe('local access boundaries', () => {
  it('rejects non-loopback hosts and mismatched browser origins', async () => {
    const app = createApp({
      logger: false,
      storage: { dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-app-test-')) },
    });

    const remoteHost = await app.inject({
      headers: { host: 'paperloop.example.com' },
      method: 'GET',
      url: '/api/v1/health',
    });
    expect(remoteHost.statusCode).toBe(403);
    expect(remoteHost.json()).toMatchObject({ code: 'INVALID_HOST' });

    const remoteOrigin = await app.inject({
      headers: { host: '127.0.0.1:3000', origin: 'http://evil.example' },
      method: 'GET',
      url: '/api/v1/health',
    });
    expect(remoteOrigin.statusCode).toBe(403);
    expect(remoteOrigin.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
    await app.close();
  });

  it('exchanges the local secret for an HttpOnly browser session', async () => {
    const app = createApp({
      connectionSecret: 'test-local-secret',
      logger: false,
      storage: { dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-app-test-')) },
    });

    const unauthorized = await app.inject({ method: 'POST', url: '/api/v1/session' });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      headers: { authorization: 'Bearer test-local-secret' },
      method: 'POST',
      url: '/api/v1/session',
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(response.headers['set-cookie']).not.toContain('test-local-secret');
    await app.close();
  });

  it('serves the built workbench and SPA routes when configured', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'paperloop-web-test-'));
    writeFileSync(join(webRoot, 'index.html'), '<main>Paperloop workbench</main>');
    const app = createApp({
      logger: false,
      storage: { dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-app-test-')) },
      webRoot,
    });

    const response = await app.inject({
      headers: { accept: 'text/html' },
      method: 'GET',
      url: '/projects/example',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Paperloop workbench');
    await app.close();
  });
});
