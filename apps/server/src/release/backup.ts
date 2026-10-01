import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import {
  acquireInstanceLock,
  INSTANCE_LOCK_FILE_NAME,
} from '../runtime/instance-lock.js';
import { DEFAULT_DATABASE_FILE_NAME } from '../storage/database.js';

export async function backupData(
  dataDirectory: string,
  destination: string,
): Promise<string> {
  const source = resolve(dataDirectory);
  const target = resolve(destination);
  const inside = relative(source, target);
  if (
    !inside ||
    (!inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside))
  )
    throw new Error('Choose a backup destination outside the data directory.');
  if (existsSync(target))
    throw new Error(
      'Backup destination already exists. Choose a new directory.',
    );
  if (!existsSync(join(source, DEFAULT_DATABASE_FILE_NAME)))
    throw new Error('No Paperloop database exists in this data directory.');
  // A complete snapshot includes artifacts and workspace metadata. Require a stopped server.
  const ownership = acquireInstanceLock(source);
  let sqlite: Database.Database | undefined;
  let created = false;
  try {
    mkdirSync(target, { mode: 0o700 });
    created = true;
    sqlite = new Database(join(source, DEFAULT_DATABASE_FILE_NAME), {
      readonly: true,
      fileMustExist: true,
    });
    await sqlite.backup(join(target, DEFAULT_DATABASE_FILE_NAME));
    chmodSync(join(target, DEFAULT_DATABASE_FILE_NAME), 0o600);
    for (const name of readdirSync(source)) {
      if (
        [
          INSTANCE_LOCK_FILE_NAME,
          DEFAULT_DATABASE_FILE_NAME,
          `${DEFAULT_DATABASE_FILE_NAME}-wal`,
          `${DEFAULT_DATABASE_FILE_NAME}-shm`,
          'backups',
        ].includes(name)
      )
        continue;
      cpSync(join(source, name), join(target, name), {
        recursive: true,
        dereference: false,
      });
    }
    return target;
  } catch (error) {
    if (created) rmSync(target, { recursive: true, force: true });
    throw error;
  } finally {
    sqlite?.close();
    ownership.release();
  }
}
