import { mkdtempSync } from 'node:fs';
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
