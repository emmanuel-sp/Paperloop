import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, opendirSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  EvaluationSuiteDraft,
  WorkspaceObservation,
} from '@paperloop/contracts';
import { ARTIFACT_BYTES, readEvidence } from './suite-files.js';

const SCOPE =
  'workspace-without-git-dependencies-and-approved-reports-v1' as const;
const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'uv.lock',
  'poetry.lock',
  'Pipfile.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
]);
export interface ObservationScope {
  excluded: Set<string>;
  exclusionFingerprint: string;
}
export function observationScope(
  workspace: string,
  suite: EvaluationSuiteDraft,
): ObservationScope {
  const root = realpathSync(workspace);
  const excluded = new Set<string>();
  for (const check of suite.checks) {
    if (check.report.adapter === 'exit-code') continue;
    const cwd = resolve(root, check.command.workingDirectory);
    excluded.add(relative(root, resolve(cwd, check.report.path)));
    if (check.report.adapter === 'metrics-v1' && check.report.cases)
      excluded.add(relative(root, resolve(cwd, check.report.cases.path)));
  }
  const exclusionFingerprint = createHash('sha256')
    .update(JSON.stringify([SCOPE, [...excluded].sort()]))
    .digest('hex');
  return { excluded, exclusionFingerprint };
}
export function unavailableObservation(
  scope: ObservationScope,
  reason: string,
): WorkspaceObservation {
  return {
    status: 'unavailable',
    identity: null,
    revision: null,
    scope: SCOPE,
    exclusionFingerprint: scope.exclusionFingerprint,
    files: 0,
    bytes: 0,
    lockfiles: [],
    reason: reason.slice(0, 2000),
  };
}
// A scoped content observation, not an attestation of dataset/environment equality.
// Never read arbitrary tool versions or print file contents/environment values.
export function observeWorkspace(
  workspace: string,
  scope: ObservationScope,
): WorkspaceObservation {
  const result = unavailableObservation(
    scope,
    'Workspace observation did not complete.',
  );
  const deadline = performance.now() + 1000;
  let entries = 0;
  const files: Array<{ path: string; digest: string; size: number }> = [];
  const states: Array<{ path: string; metadata: string }> = [];
  const metadata = (path: string) => {
    const stat = lstatSync(path);
    return JSON.stringify([
      stat.dev,
      stat.ino,
      stat.mode,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
    ]);
  };
  try {
    const root = realpathSync(workspace);
    const checkBounds = () => {
      if (performance.now() > deadline)
        throw new Error('Workspace observation exceeded its one-second bound.');
    };
    function visit(directory: string, depth: number) {
      checkBounds();
      states.push({ path: directory, metadata: metadata(directory) });
      if (depth > 64) throw new Error('Workspace nesting exceeds 64 levels.');
      const handle = opendirSync(directory);
      const names: string[] = [];
      try {
        for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
          checkBounds();
          if (++entries > 20000)
            throw new Error('Workspace observation exceeds 20,000 entries.');
          names.push(entry.name);
        }
      } finally {
        handle.closeSync();
      }
      for (const name of names.sort()) {
        checkBounds();
        if (name === '.git' || name === 'node_modules') continue;
        const path = join(directory, name),
          label = relative(root, path);
        if (scope.excluded.has(label)) continue;
        if (label.length > 500)
          throw new Error('Workspace observation path exceeds 500 characters.');
        const stat = lstatSync(path);
        if (stat.isSymbolicLink())
          throw new Error(
            'Workspace observation cannot follow symbolic links.',
          );
        if (stat.isDirectory()) visit(path, depth + 1);
        else if (stat.isFile()) {
          if (files.length >= 10000 || result.bytes + stat.size > 50000000)
            throw new Error(
              'Workspace observation exceeds its 10,000-file or 50 MB bound.',
            );
          states.push({ path, metadata: metadata(path) });
          const bytes = readEvidence(root, root, label, ARTIFACT_BYTES);
          if (result.bytes + bytes.length > 50000000)
            throw new Error('Workspace observation exceeds 50 MB.');
          const digest = createHash('sha256').update(bytes).digest('hex');
          files.push({ path: label, digest, size: bytes.length });
          result.files = files.length;
          result.bytes += bytes.length;
          if (LOCKFILES.has(basename(path))) {
            if (result.lockfiles.length >= 50)
              throw new Error('Workspace observation exceeds 50 lockfiles.');
            result.lockfiles.push({ path: label, sha256: digest });
          }
        } else
          throw new Error(
            'Workspace observation requires regular files and directories.',
          );
      }
    }
    visit(root, 0);
    // Recheck metadata after the traversal so an actively changing repository is
    // not labeled a complete stable snapshot. Content reads also check fd state.
    // Snapshot evidence describes what was read; it does not assert sandboxing.
    for (const state of states) {
      checkBounds();
      if (metadata(state.path) !== state.metadata)
        throw new Error('Workspace changed during observation.');
    }
    checkBounds();
    try {
      result.revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 250,
        maxBuffer: 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' },
      }).trim();
      if (!/^[a-f0-9]{40,64}$/.test(result.revision)) result.revision = null;
    } catch {
      /* Non-Git or unavailable revision stays explicitly unobserved. */
    }
    checkBounds();
    result.identity = createHash('sha256')
      .update(
        JSON.stringify(
          files.sort((a, b) =>
            a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
          ),
        ),
      )
      .digest('hex');
    result.status = 'observed';
    delete result.reason;
  } catch (error) {
    result.reason = (
      error instanceof Error
        ? error.message
        : 'Workspace observation unavailable.'
    ).slice(0, 2000);
  }
  return result;
}
