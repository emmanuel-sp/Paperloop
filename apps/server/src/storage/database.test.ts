import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
  it('upgrades the real research-era schema with a recoverable v3 backup', () => {
    const dataDirectory = makeDataDirectory();
    const migrationsFolder = mkdtempSync(
      join(tmpdir(), 'paperloop-v3-migrations-'),
    );
    mkdirSync(join(migrationsFolder, 'meta'));
    const journal = JSON.parse(
      readFileSync(
        new URL('../../drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.slice(0, 3);
    writeFileSync(
      join(migrationsFolder, 'meta', '_journal.json'),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      copyFileSync(
        new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url),
        join(migrationsFolder, `${entry.tag}.sql`),
      );
    const previous = new Database(join(dataDirectory, 'paperloop.sqlite'));
    migrate(drizzle(previous), { migrationsFolder });
    expect(previous.pragma('user_version', { simple: true })).toBe(3);
    previous.exec(
      "INSERT INTO app_state (key,value,updated_at) VALUES ('existing-state','preserved',0)",
    );
    previous.close();
    const current = openDatabase({ dataDirectory });
    expect(current.sqlite.pragma('user_version', { simple: true })).toBe(
      SUPPORTED_SCHEMA_VERSION,
    );
    expect(
      current.sqlite
        .prepare('SELECT value FROM app_state WHERE key = ?')
        .pluck()
        .get('existing-state'),
    ).toBe('preserved');
    const backup = new Database(current.backupPath!, { readonly: true });
    expect(backup.pragma('user_version', { simple: true })).toBe(3);
    expect(
      backup
        .prepare('SELECT value FROM app_state WHERE key = ?')
        .pluck()
        .get('existing-state'),
    ).toBe('preserved');
    backup.close();
    current.close();
  });
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
    expect(backup.prepare('SELECT value FROM legacy_data').pluck().get()).toBe(
      'preserve-me',
    );
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(backup.pragma('user_version', { simple: true })).toBe(0);
    backup.close();

    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe(
      'ok',
    );
    expect(database.sqlite.pragma('user_version', { simple: true })).toBe(
      SUPPORTED_SCHEMA_VERSION,
    );
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
