import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export const SUPPORTED_SCHEMA_VERSION = 2;
export const DEFAULT_DATABASE_FILE_NAME = 'paperloop.sqlite';

const defaultMigrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

export class IncompatibleSchemaError extends Error {
  constructor(
    public readonly foundVersion: number,
    public readonly supportedVersion: number,
  ) {
    super(
      `Database schema version ${foundVersion} is newer than supported version ${supportedVersion}. Upgrade Paperloop before opening this data directory.`,
    );
    this.name = 'IncompatibleSchemaError';
  }
}

export interface DataDirectoryEnvironment {
  LOCALAPPDATA?: string;
  PAPERLOOP_DATA_DIR?: string;
  XDG_DATA_HOME?: string;
}

export interface ResolveDataDirectoryOptions {
  environment?: DataDirectoryEnvironment;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}

export function resolveDataDirectory(
  options: ResolveDataDirectoryOptions = {},
): string {
  const environment = options.environment ?? process.env;
  const configuredDirectory = environment.PAPERLOOP_DATA_DIR?.trim();

  if (configuredDirectory) {
    return resolve(configuredDirectory);
  }

  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();

  if (platform === 'win32' && environment.LOCALAPPDATA) {
    return join(environment.LOCALAPPDATA, 'Paperloop');
  }

  if (environment.XDG_DATA_HOME) {
    return join(environment.XDG_DATA_HOME, 'paperloop');
  }

  return join(homeDirectory, '.local', 'share', 'paperloop');
}

export interface OpenDatabaseOptions {
  dataDirectory?: string;
  databaseFileName?: string;
  migrationsFolder?: string;
  now?: () => Date;
}

export interface PaperloopDatabase {
  backupPath?: string;
  dataDirectory: string;
  databasePath: string;
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  close(): void;
}

function readSchemaVersion(sqlite: Database.Database): number {
  const row = sqlite.pragma('user_version', { simple: true });

  if (typeof row !== 'number' || !Number.isSafeInteger(row) || row < 0) {
    throw new Error('SQLite returned an invalid schema version.');
  }

  return row;
}

function createBackupPath(dataDirectory: string, now: Date): string {
  const backupDirectory = join(dataDirectory, 'backups');
  mkdirSync(backupDirectory, { mode: 0o700, recursive: true });

  const timestamp = now.toISOString().replaceAll(/[^0-9]/g, '');
  const baseName = `paperloop-before-v${SUPPORTED_SCHEMA_VERSION}-${timestamp}`;
  let backupPath = join(backupDirectory, `${baseName}.sqlite`);
  let suffix = 1;

  while (existsSync(backupPath)) {
    backupPath = join(backupDirectory, `${baseName}-${suffix}.sqlite`);
    suffix += 1;
  }

  return backupPath;
}

function backUpDatabase(
  sqlite: Database.Database,
  dataDirectory: string,
  now: Date,
): string {
  const backupPath = createBackupPath(dataDirectory, now);
  sqlite.prepare('VACUUM INTO ?').run(backupPath);
  return backupPath;
}

export function openDatabase(
  options: OpenDatabaseOptions = {},
): PaperloopDatabase {
  const dataDirectory = resolve(
    options.dataDirectory ?? resolveDataDirectory(),
  );
  const databasePath = join(
    dataDirectory,
    options.databaseFileName ?? DEFAULT_DATABASE_FILE_NAME,
  );
  const databaseExisted =
    existsSync(databasePath) && statSync(databasePath).size > 0;

  mkdirSync(dirname(databasePath), { mode: 0o700, recursive: true });

  const sqlite = new Database(databasePath);

  try {
    const currentVersion = readSchemaVersion(sqlite);
    if (currentVersion > SUPPORTED_SCHEMA_VERSION) {
      throw new IncompatibleSchemaError(
        currentVersion,
        SUPPORTED_SCHEMA_VERSION,
      );
    }

    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');

    const needsMigration = currentVersion < SUPPORTED_SCHEMA_VERSION;
    const backupPath =
      needsMigration && databaseExisted
        ? backUpDatabase(sqlite, dataDirectory, options.now?.() ?? new Date())
        : undefined;

    const db = drizzle(sqlite, { schema });

    if (needsMigration) {
      migrate(db, {
        migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
      });
    }

    const migratedVersion = readSchemaVersion(sqlite);
    if (migratedVersion !== SUPPORTED_SCHEMA_VERSION) {
      throw new Error(
        `Database migration finished at schema version ${migratedVersion}; expected ${SUPPORTED_SCHEMA_VERSION}.`,
      );
    }

    return {
      ...(backupPath ? { backupPath } : {}),
      dataDirectory,
      databasePath,
      db,
      sqlite,
      close: () => sqlite.close(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
