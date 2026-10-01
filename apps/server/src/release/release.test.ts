import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database.js';
import { acquireInstanceLock } from '../runtime/instance-lock.js';
import { backupData } from './backup.js';
import { runtimeProblem, diagnostics } from './diagnostics.js';
import { createApp } from '../app.js';
describe('release runtime and complete backups', () => {
  it('checks runtime and configuration without opening or migrating application data', () => {
    expect(runtimeProblem('22.0.0', 'linux')).toContain('Node.js 24');
    expect(runtimeProblem('24.15.0', 'win32')).toContain('WSL2');
    expect(runtimeProblem('24.15.0', 'darwin')).toBeUndefined();
    const directory = join(
      mkdtempSync(join(tmpdir(), 'paperloop-doctor-')),
      'absent',
    );
    expect(
      diagnostics({
        dataDirectory: directory,
        host: '127.0.0.1',
        port: 3000,
      }).join('\n'),
    ).toContain(directory);
    expect(existsSync(directory)).toBe(false);
  });
  it('restores project state, credential and artifacts and refuses live or unsafe destinations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paperloop-backup-'));
    const source = join(root, 'data');
    const app = createApp({
      connectionSecret: 'backup-fixture',
      storage: { dataDirectory: source },
      logger: false,
      dispatcher: false,
    });
    const project = app.projects.create({
      name: 'Backed up project',
      description: '',
      objectives: [],
      constraints: [],
    });
    writeFileSync(join(source, 'connection-secret'), 'private-secret', {
      mode: 0o600,
    });
    writeFileSync(join(source, 'evidence.txt'), 'measured evidence');
    const lock = acquireInstanceLock(source);
    try {
      await expect(backupData(source, join(root, 'blocked'))).rejects.toThrow(
        /already running/,
      );
    } finally {
      lock.release();
    }
    await expect(backupData(source, join(source, 'nested'))).rejects.toThrow(
      /outside/,
    );
    await app.close();
    const destination = await backupData(source, join(root, 'snapshot'));
    expect(readFileSync(join(destination, 'connection-secret'), 'utf8')).toBe(
      'private-secret',
    );
    expect(readFileSync(join(destination, 'evidence.txt'), 'utf8')).toBe(
      'measured evidence',
    );
    expect(existsSync(join(destination, 'paperloop.lock'))).toBe(false);
    await expect(backupData(source, destination)).rejects.toThrow(
      /already exists/,
    );
    const db = openDatabase({ dataDirectory: destination });
    expect(db.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    db.close();
    const restored = createApp({
      connectionSecret: 'backup-fixture',
      storage: { dataDirectory: destination },
      logger: false,
      dispatcher: false,
    });
    expect(restored.projects.get(project.id).name).toBe('Backed up project');
    await restored.close();
  });
});
