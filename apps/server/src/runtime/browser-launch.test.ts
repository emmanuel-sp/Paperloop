import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { BrowserLaunch, browserCommand } from './browser-launch.js';
import { startServer } from './server.js';

function token(url: string): string {
  return new URLSearchParams(new URL(url).hash.slice(1)).get('launch')!;
}

describe('trusted browser launch', () => {
  it('expires, replaces and consumes single-use capabilities bound to the launched origin', () => {
    let now = 0;
    const launch = new BrowserLaunch(() => now);
    expect(() => launch.issue('https://example.com')).toThrow(/local service/);
    const first = token(launch.issue('http://127.0.0.1:3000'));
    expect(launch.consume(first, 'http://localhost:3000')).toBe(false);
    expect(launch.consume(first, 'http://127.0.0.1:3001')).toBe(false);
    expect(launch.consume(first, undefined)).toBe(false);
    expect(launch.consume('invalid', 'http://127.0.0.1:3000')).toBe(false);
    const second = token(launch.issue('http://127.0.0.1:3000'));
    expect(second).not.toBe(first);
    expect(launch.consume(first, 'http://127.0.0.1:3000')).toBe(false);
    expect(launch.consume(second, 'http://127.0.0.1:3000')).toBe(true);
    expect(launch.consume(second, 'http://127.0.0.1:3000')).toBe(false);
    const expired = token(launch.issue('http://[::1]:3000'));
    now = 60_000;
    expect(launch.consume(expired, 'http://[::1]:3000')).toBe(false);
    const cancelled = token(launch.issue('http://127.0.0.1:3000'));
    launch.clear();
    expect(launch.consume(cancelled, 'http://127.0.0.1:3000')).toBe(false);
  });

  it('opens through platform tools without a shell, including the Windows browser from WSL', () => {
    const url = 'http://127.0.0.1:3000/#launch=fixture';
    expect(browserCommand(url, 'darwin', false)).toEqual({ executable: 'open', arguments: [url] });
    expect(browserCommand(url, 'linux', false)).toEqual({ executable: 'xdg-open', arguments: [url] });
    const wsl = browserCommand(url, 'linux', true);
    expect(wsl.executable).toBe('powershell.exe');
    expect(Buffer.from(wsl.arguments.at(-1)!, 'base64').toString('utf16le')).toBe(`Start-Process '${url}'`);
  });

  it('requires the capability and same origin, issues the normal cookie, and rejects concurrent replay', async () => {
    const launch = new BrowserLaunch();
    const credential = token(launch.issue('http://127.0.0.1:3000'));
    const app = createApp({
      browserLaunch: launch,
      connectionSecret: 'long-lived-test-secret',
      logger: false,
      dispatcher: false,
      storage: { dataDirectory: mkdtempSync(join(tmpdir(), 'paperloop-launch-')) },
    });
    try {
      const exchange = (body: Record<string, unknown>, origin: string | undefined = 'http://127.0.0.1:3000', host = '127.0.0.1:3000') => app.inject({
        method: 'POST', url: '/api/v1/session/launch',
        headers: { host, ...(origin ? { origin } : {}) }, payload: body,
      });
      const noOrigin = await app.inject({
        method: 'POST', url: '/api/v1/session/launch',
        headers: { host: '127.0.0.1:3000' }, payload: { token: credential },
      });
      expect(noOrigin.statusCode).toBe(403);
      expect((await exchange({ token: credential }, 'http://evil.example')).statusCode).toBe(403);
      expect((await exchange({ token: credential }, 'http://evil.example', 'evil.example')).statusCode).toBe(403);
      expect((await exchange({ token: 'long-lived-test-secret' })).statusCode).toBe(401);
      expect((await exchange({ token: credential }, 'http://localhost:3000', 'localhost:3000')).statusCode).toBe(401);
      expect((await exchange({ token: null })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { host: '127.0.0.1:3000' } })).statusCode).toBe(401);
      const responses = await Promise.all([exchange({ token: credential }), exchange({ token: credential })]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 401]);
      const successful = responses.find((response) => response.statusCode === 204)!;
      expect(successful.headers['cache-control']).toBe('no-store');
      const cookie = String(successful.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).not.toContain(credential);
      expect(cookie).not.toContain('long-lived-test-secret');
      expect((await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { host: '127.0.0.1:3000', cookie } })).statusCode).toBe(200);
      // Agents still need the long-lived credential; launch tokens aren't bearer credentials.
      expect((await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: `Bearer ${credential}` } })).statusCode).toBe(401);
      const manual = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { authorization: 'Bearer long-lived-test-secret' } });
      expect(manual.statusCode).toBe(204);
      expect(manual.headers['set-cookie']).toBe(cookie);
      const pending = token(launch.issue('http://127.0.0.1:3000'));
      await app.close();
      expect(launch.consume(pending, 'http://127.0.0.1:3000')).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('launches against the actual listening port and invalidates capabilities on shutdown/restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paperloop-launch-runtime-'));
    const webRoot = join(directory, 'web');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(webRoot);
    writeFileSync(join(webRoot, 'index.html'), '<main>Workbench</main>');
    const configuration = { dataDirectory: join(directory, 'data'), host: '127.0.0.1' as const, port: 0, webRoot };
    const server = await startServer({ configuration, installSignalHandlers: false });
    let oldToken: string;
    try {
      const url = server.browserLaunchUrl()!;
      expect(new URL(url).origin).toBe(server.address);
      const response = await fetch(`${server.address}/api/v1/session/launch`, {
        method: 'POST', headers: { origin: server.address, 'content-type': 'application/json' },
        body: JSON.stringify({ token: token(url) }),
      });
      expect(response.status).toBe(204);
      oldToken = token(server.browserLaunchUrl()!);
    } finally {
      await server.close();
    }
    const restarted = await startServer({ configuration, installSignalHandlers: false });
    try {
      const response = await fetch(`${restarted.address}/api/v1/session/launch`, {
        method: 'POST', headers: { origin: restarted.address, 'content-type': 'application/json' },
        body: JSON.stringify({ token: oldToken }),
      });
      expect(response.status).toBe(401);
    } finally {
      await restarted.close();
    }
  });
});
