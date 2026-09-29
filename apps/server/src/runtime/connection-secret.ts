import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const CONNECTION_SECRET_FILE_NAME = 'connection-secret';

export interface ConnectionSecret {
  filePath: string;
  value: string;
}

function readAndValidateSecret(filePath: string): string {
  const file = statSync(filePath);
  if (!file.isFile()) {
    throw new Error(`Connection secret is not a regular file: ${filePath}`);
  }
  if ((file.mode & 0o077) !== 0) {
    throw new Error(
      `Connection secret permissions are too broad: ${filePath}. Expected mode 600.`,
    );
  }

  const value = readFileSync(filePath, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(`Connection secret has an invalid format: ${filePath}`);
  }
  return value;
}

export function loadOrCreateConnectionSecret(
  dataDirectory: string,
): ConnectionSecret {
  mkdirSync(dataDirectory, { mode: 0o700, recursive: true });
  const filePath = join(dataDirectory, CONNECTION_SECRET_FILE_NAME);

  try {
    const descriptor = openSync(filePath, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${randomBytes(32).toString('base64url')}\n`);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  chmodSync(filePath, 0o600);
  return { filePath, value: readAndValidateSecret(filePath) };
}
