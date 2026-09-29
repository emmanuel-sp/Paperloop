import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfiguration } from './configuration.js';
import { loadOrCreateConnectionSecret } from './connection-secret.js';
import { acquireInstanceLock, INSTANCE_LOCK_FILE_NAME } from './instance-lock.js';
import { startServer } from './server.js';

function makeDataDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'paperloop-runtime-'));
}

describe('configuration', () => {
  it('accepts only valid ports and loopback hosts', () => {
    expect(
      loadConfiguration({
        PAPERLOOP_DATA_DIR: '/tmp/paperloop-config-test',
        PAPERLOOP_HOST: '::1',
        PAPERLOOP_PORT: '4321',
      }),
    ).toMatchObject({ host: '::1', port: 4321 });

    expect(() => loadConfiguration({ PAPERLOOP_HOST: '0.0.0.0' })).toThrow(
      'PAPERLOOP_HOST',
    );
    expect(() => loadConfiguration({ PAPERLOOP_PORT: 'not-a-port' })).toThrow(
      'PAPERLOOP_PORT',
    );
  });
});

describe('local credentials', () => {
  it('creates and reuses a secret with owner-only permissions', () => {
    const dataDirectory = makeDataDirectory();
    const first = loadOrCreateConnectionSecret(dataDirectory);
    const second = loadOrCreateConnectionSecret(dataDirectory);

    expect(second.value).toBe(first.value);
    expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(first.filePath).mode & 0o077).toBe(0);

    chmodSync(first.filePath, 0o644);
    const repaired = loadOrCreateConnectionSecret(dataDirectory);
    expect(repaired.value).toBe(first.value);
    expect(statSync(first.filePath).mode & 0o077).toBe(0);
  });
});

describe('single-instance ownership', () => {
  it('rejects a concurrent owner and recovers a stale lock', () => {
    const dataDirectory = makeDataDirectory();
    const first = acquireInstanceLock(dataDirectory);
    expect(() => acquireInstanceLock(dataDirectory)).toThrow('already running');
    first.release();

    const lockPath = join(dataDirectory, INSTANCE_LOCK_FILE_NAME);
    writeFileSync(
      lockPath,
      JSON.stringify({
        instanceId: 'stale',
        pid: 2_147_483_647,
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const recovered = acquireInstanceLock(dataDirectory);
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({
      instanceId: recovered.instanceId,
      pid: process.pid,
    });
    recovered.release();
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('server lifecycle', () => {
  it('starts on loopback, reports health, and releases ownership on close', async () => {
    const dataDirectory = makeDataDirectory();
    const server = await startServer({
      configuration: {
        dataDirectory,
        host: '127.0.0.1',
        port: 0,
      },
      installSignalHandlers: false,
    });

    const response = await fetch(`${server.address}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(existsSync(join(dataDirectory, INSTANCE_LOCK_FILE_NAME))).toBe(true);

    await server.close();
    expect(existsSync(join(dataDirectory, INSTANCE_LOCK_FILE_NAME))).toBe(false);
  });
});
