import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  IncompatibleSchemaError,
  openDatabase,
  resolveDataDirectory,
  SUPPORTED_SCHEMA_VERSION,
} from './database.js';
import { appState } from './schema.js';

function makeDataDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'paperloop-storage-'));
}

describe('resolveDataDirectory', () => {
  it('prefers the configured Paperloop data directory', () => {
    expect(
      resolveDataDirectory({
        environment: { PAPERLOOP_DATA_DIR: '/var/lib/paperloop-test' },
        homeDirectory: '/home/someone',
        platform: 'linux',
      }),
    ).toBe('/var/lib/paperloop-test');
  });

  it('uses the platform data location by default', () => {
    expect(
      resolveDataDirectory({
        environment: {},
        homeDirectory: '/home/someone',
        platform: 'linux',
      }),
    ).toBe('/home/someone/.local/share/paperloop');
  });
});

describe('openDatabase', () => {
  it('enables foreign keys and WAL and runs the current migration', () => {
    const database = openDatabase({ dataDirectory: makeDataDirectory() });

    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe(
      'wal',
    );
    expect(database.sqlite.pragma('user_version', { simple: true })).toBe(
      SUPPORTED_SCHEMA_VERSION,
    );

    database.close();
  });

  it('persists application state across restarts', () => {
    const dataDirectory = makeDataDirectory();
    const first = openDatabase({ dataDirectory });
    const updatedAt = new Date('2026-01-02T03:04:05.000Z');

    first.db
      .insert(appState)
      .values({ key: 'installation-id', value: 'local-123', updatedAt })
      .run();
    first.close();

    const second = openDatabase({ dataDirectory });
    const stored = second.db
      .select()
      .from(appState)
      .where(eq(appState.key, 'installation-id'))
      .get();

    expect(stored).toEqual({
      key: 'installation-id',
      value: 'local-123',
      updatedAt,
    });
    expect(second.backupPath).toBeUndefined();
    second.close();
  });

  it('creates a consistent backup before migrating an existing database', () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, 'paperloop.sqlite');
    const legacy = new Database(databasePath);
    legacy.exec(
      "CREATE TABLE legacy_data (value TEXT NOT NULL); INSERT INTO legacy_data VALUES ('preserve-me');",
    );
    legacy.close();

    const database = openDatabase({
      dataDirectory,
      now: () => new Date('2026-02-03T04:05:06.007Z'),
    });

    expect(database.backupPath).toBeDefined();
    const backup = new Database(database.backupPath, { readonly: true });
    expect(
      backup.prepare('SELECT value FROM legacy_data').pluck().get(),
    ).toBe('preserve-me');
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(backup.pragma('user_version', { simple: true })).toBe(0);
    backup.close();

    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe(
      'ok',
    );
    expect(database.sqlite.pragma('user_version', { simple: true })).toBe(1);
    database.close();
  });

  it('refuses a database created by a newer Paperloop version', () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, 'paperloop.sqlite');
    const newer = new Database(databasePath);
    newer.pragma(`user_version = ${SUPPORTED_SCHEMA_VERSION + 1}`);
    newer.close();

    expect(() => openDatabase({ dataDirectory })).toThrowError(
      IncompatibleSchemaError,
    );
  });
});
