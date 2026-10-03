import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SuiteCheckResult } from '@paperloop/contracts';

export class EvidenceError extends Error {
  constructor(
    public readonly evidenceStatus: SuiteCheckResult['evidenceStatus'],
    message: string,
  ) {
    super(message);
  }
}
export const REPORT_BYTES = 2_000_000;
export const ARTIFACT_BYTES = 10_000_000;
export const RUN_ARTIFACT_BYTES = 50_000_000;
export const RUN_LOG_BYTES = 10_000_000;

// Inspect every existing path component. Missing output directories may be made by
// the approved command, but evidence readers never follow report/artifact symlinks.
export function outputPath(
  workspace: string,
  cwd: string,
  path: string,
): string {
  if (
    !path ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').includes('..')
  )
    throw new EvidenceError(
      'malformed',
      'Report or artifact path must remain within the isolated workspace.',
    );
  const root = realpathSync(workspace);
  const target = resolve(cwd, path);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new EvidenceError(
      'malformed',
      'Report or artifact path leaves the isolated workspace.',
    );
  let entry = root;
  for (const component of rel.split(sep).filter(Boolean)) {
    entry = resolve(entry, component);
    try {
      if (lstatSync(entry).isSymbolicLink())
        throw new EvidenceError(
          'malformed',
          'Report and artifact paths must not contain symlinks.',
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}
export function clearReport(
  workspace: string,
  cwd: string,
  path: string,
): void {
  const target = outputPath(workspace, cwd, path);
  try {
    if (!lstatSync(target).isFile())
      throw new EvidenceError(
        'malformed',
        'The approved report path is not a regular file.',
      );
    unlinkSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export function readEvidence(
  workspace: string,
  cwd: string,
  path: string,
  limit: number,
  startedAt?: number,
): Buffer {
  let fd: number | undefined;
  try {
    const target = outputPath(workspace, cwd, path);
    fd = openSync(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(fd);
    if (!before.isFile())
      throw new EvidenceError('malformed', 'Evidence must be a regular file.');
    if (before.size > limit)
      throw new EvidenceError(
        'exceeds_limit',
        `Evidence exceeds the ${limit}-byte bound.`,
      );
    if (startedAt !== undefined && before.mtimeMs < startedAt)
      throw new EvidenceError(
        'stale',
        'The report predates this check attempt.',
      );
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const amount = readSync(fd, bytes, count, bytes.length - count, count);
      if (!amount) break;
      count += amount;
    }
    const after = fstatSync(fd);
    if (
      count !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new EvidenceError(
        'stale',
        'Evidence changed while it was being read.',
      );
    return bytes.subarray(0, count);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new EvidenceError(
        'missing',
        'The approved report or artifact was not produced.',
      );
    if ((error as NodeJS.ErrnoException).code === 'ELOOP')
      throw new EvidenceError(
        'malformed',
        'Report and artifact paths must not contain symlinks.',
      );
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export class ArtifactRegistry {
  readonly references: string[] = [];
  private bytes = 0;
  private logBytes = 0;
  constructor(private readonly directory: string) {}
  register(name: string, bytes: Buffer, log = false): void {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith('.'))
      throw new Error('Invalid harness artifact name.');
    if (
      bytes.length > ARTIFACT_BYTES ||
      this.bytes + bytes.length > RUN_ARTIFACT_BYTES ||
      (log && this.logBytes + bytes.length > RUN_LOG_BYTES)
    )
      throw new EvidenceError(
        'exceeds_limit',
        'Registered evidence exceeds its check/run artifact or log bound.',
      );
    writeFileSync(resolve(this.directory, name), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    this.bytes += bytes.length;
    if (log) this.logBytes += bytes.length;
    this.references.push(name);
  }
}
