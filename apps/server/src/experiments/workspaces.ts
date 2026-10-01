import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { WorkflowError } from '../evaluations/plan-service.js';

export function githubCheckout(
  path: string,
  owner: string,
  repository: string,
): string {
  if (!isAbsolute(path))
    throw new WorkflowError(
      'INVALID_CHECKOUT',
      'Choose an absolute path to an existing checkout of the selected GitHub repository.',
      400,
    );
  try {
    const checkout = realpathSync(path);
    const origin = git(checkout, ['remote', 'get-url', 'origin']);
    const match = origin.match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)\/?$/,
    );
    if (
      !match ||
      match[1]?.toLowerCase() !== owner.toLowerCase() ||
      match[2]?.replace(/\.git$/, '').toLowerCase() !== repository.toLowerCase()
    )
      throw new Error('Mismatched origin');
    // Require a committed Git checkout before any isolated workspace is made.
    git(checkout, ['rev-parse', '--verify', 'HEAD^{commit}']);
    return checkout;
  } catch {
    throw new WorkflowError(
      'INVALID_CHECKOUT',
      'The checkout must have a commit and an origin matching the selected GitHub repository. Check its path and remote, then retry.',
      400,
    );
  }
}

export function git(path: string, args: string[]): string {
  return execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4_000_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
export function within(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(realpathSync(root), realpathSync(target));
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new WorkflowError(
      'INVALID_ARTIFACT',
      'Path leaves the isolated workspace.',
      400,
    );
  return target;
}
export function manifest(path: string, includeDependencies = false): string {
  const hash = createHash('sha256');
  function visit(directory: string) {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.git' || (!includeDependencies && name === 'node_modules'))
        continue;
      const entry = join(directory, name);
      const stat = lstatSync(entry);
      if (stat.isSymbolicLink())
        throw new WorkflowError(
          'UNSAFE_WORKSPACE',
          'Isolated copies must not contain symbolic links.',
        );
      if (stat.isDirectory()) visit(entry);
      else if (stat.isFile()) {
        const filename = relative(path, entry);
        const content = readFileSync(entry);
        hash.update(JSON.stringify([filename, content.length]));
        hash.update(content);
      }
    }
  }
  visit(path);
  return hash.digest('hex');
}
export function prepareWorkspaces(
  root: string,
  original: string,
  revision: string | undefined,
  explicitCopy: string | undefined,
) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const baselinePath = join(root, 'baseline');
  const candidatePath = join(root, 'candidate');
  let head: string | undefined;
  try {
    head = git(original, [
      'rev-parse',
      '--verify',
      `${revision ?? 'HEAD'}^{commit}`,
    ]);
  } catch {
    if (revision)
      throw new WorkflowError(
        'INVALID_REVISION',
        'The supplied baseline revision is unavailable.',
      );
  }
  if (head) {
    git(original, ['worktree', 'add', '--detach', baselinePath, head]);
    git(original, ['worktree', 'add', '--detach', candidatePath, head]);
    return { baselinePath, candidatePath, baselineRevision: head };
  }
  if (!explicitCopy)
    throw new WorkflowError(
      'ISOLATED_COPY_REQUIRED',
      'Prepare a separate non-Git copy and explicitly supply its path.',
    );
  const copy = realpathSync(explicitCopy);
  const source = realpathSync(original);
  const relation = relative(source, copy);
  const reverse = relative(copy, source);
  const nested = (value: string) =>
    !value ||
    (value !== '..' && !value.startsWith('../') && !isAbsolute(value));
  if (nested(relation) || nested(reverse))
    throw new WorkflowError(
      'ISOLATED_COPY_REQUIRED',
      'The copy must be separate from the original project directory.',
    );
  const baselineRevision = manifest(copy, true);
  cpSync(copy, baselinePath, { recursive: true });
  cpSync(copy, candidatePath, { recursive: true });
  return { baselinePath, candidatePath, baselineRevision };
}
export function codeIdentity(path: string): string {
  let revision = 'non-git';
  try {
    revision = git(path, ['rev-parse', 'HEAD']);
  } catch {
    /* Explicit copy. */
  }
  return `${revision}:${manifest(path)}`;
}
