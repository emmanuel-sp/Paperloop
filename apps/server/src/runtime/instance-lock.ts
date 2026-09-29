import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const INSTANCE_LOCK_FILE_NAME = 'paperloop.lock';

interface LockContents {
  instanceId: string;
  pid: number;
  startedAt: string;
}

export interface InstanceLock {
  filePath: string;
  instanceId: string;
  release(): void;
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(filePath: string): LockContents | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LockContents>;
    if (
      typeof parsed.instanceId === 'string' &&
      typeof parsed.pid === 'number' &&
      typeof parsed.startedAt === 'string'
    ) {
      return parsed as LockContents;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function acquireInstanceLock(dataDirectory: string): InstanceLock {
  mkdirSync(dataDirectory, { mode: 0o700, recursive: true });
  const filePath = join(dataDirectory, INSTANCE_LOCK_FILE_NAME);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const instanceId = randomUUID();
    try {
      const descriptor = openSync(filePath, 'wx', 0o600);
      try {
        writeFileSync(
          descriptor,
          JSON.stringify({
            instanceId,
            pid: process.pid,
            startedAt: new Date().toISOString(),
          } satisfies LockContents),
        );
      } finally {
        closeSync(descriptor);
      }

      return {
        filePath,
        instanceId,
        release: () => {
          const current = readLock(filePath);
          if (current?.instanceId === instanceId) {
            unlinkSync(filePath);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      const current = readLock(filePath);
      if (current && processIsRunning(current.pid)) {
        throw new Error(
          `Paperloop is already running with PID ${current.pid} for ${dataDirectory}.`,
          { cause: error },
        );
      }
      unlinkSync(filePath);
    }
  }

  throw new Error(`Unable to acquire Paperloop instance ownership for ${dataDirectory}.`);
}
