import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  legacyEvaluationResultSchema,
  isEvaluationSuite,
  type EvaluationPlan,
  type LegacyEvaluationResult,
} from '@paperloop/contracts';
import { within } from '../experiments/workspaces.js';
import { confirmProcessGroupStopped } from './process-group.js';

export interface Execution {
  cancel(): void;
  done: Promise<{
    status: 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'interrupted';
    result: LegacyEvaluationResult | null;
    error: string | null;
    exitCode: number | null;
    artifacts: string[];
  }>;
}
export function executePlan(
  plan: EvaluationPlan,
  workspace: string,
  artifactDirectory: string,
): Execution {
  if (isEvaluationSuite(plan.configuration))
    throw new Error('Layered Evaluation execution is not available yet.');
  const configuration = plan.configuration;
  const command = configuration.command;
  const cwd = within(workspace, command.workingDirectory);
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  const resultPath = resolve(cwd, command.resultPath);
  // Never accept a result left by a previous attempt.
  let previousMtime = 0;
  try {
    previousMtime = statSync(resultPath).mtimeMs;
  } catch {
    /* Not produced yet. */
  }
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LANG: 'C.UTF-8',
  };
  for (const name of command.environmentReferences) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  const child = spawn(command.executable, command.arguments, {
    cwd,
    env: environment,
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let stop: 'cancelled' | 'timed_out' | undefined;
  let closing = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = () => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already exited. */
    }
    killTimer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    }, 250);
  };
  child.stdout.on('data', (data: Buffer) => {
    stdout = (stdout + data.toString()).slice(-1_000_000);
  });
  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-1_000_000);
  });
  const timeout = setTimeout(() => {
    if (closing || stop) return;
    stop = 'timed_out';
    kill();
  }, command.timeoutMs);
  const done: Execution['done'] = new Promise((done) => {
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', async (exitCode) => {
      closing = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      // Descendants may keep running after their leader exits.
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Group exited. */
        }
      }
      const stopped =
        !child.pid || (await confirmProcessGroupStopped(child.pid));
      try {
        writeFileSync(join(artifactDirectory, 'stdout.log'), stdout, {
          mode: 0o600,
        });
        writeFileSync(join(artifactDirectory, 'stderr.log'), stderr, {
          mode: 0o600,
        });
      } catch (failure) {
        done({
          status: 'interrupted',
          result: null,
          error: `Could not persist evaluation logs: ${failure instanceof Error ? failure.message : 'Unknown error'}. Inspect and reconcile before retrying.`,
          exitCode,
          artifacts: [],
        });
        return;
      }
      let result: LegacyEvaluationResult | null = null;
      let error: string | null = null;
      let status:
        | 'completed'
        | 'failed'
        | 'timed_out'
        | 'cancelled'
        | 'interrupted' = stop ?? 'failed';
      const artifacts: string[] = ['stdout.log', 'stderr.log'];
      if (!stopped) {
        status = 'interrupted';
        error =
          'Could not confirm the process group stopped. Inspect surviving processes and reconcile before retrying.';
      } else if (spawnError) error = spawnError.message;
      else if (stop) error = `Evaluation ${stop}.`;
      else if (exitCode !== 0)
        error = `Evaluation exited with code ${exitCode}.`;
      else {
        try {
          const checked = within(workspace, resultPath);
          const stat = statSync(checked);
          if (stat.mtimeMs === previousMtime || stat.size > 2_000_000)
            throw new Error('Result is stale or exceeds 2 MB.');
          result = legacyEvaluationResultSchema.parse(
            JSON.parse(readFileSync(checked, 'utf8')),
          );
          for (const criterion of configuration.metrics) {
            const metric = result.metrics.find(
              (metric) => metric.name === criterion.name,
            );
            if (!metric || metric.unit !== criterion.unit)
              throw new Error(
                `Missing metric or incompatible unit: ${criterion.name}.`,
              );
          }
          for (const [index, reference] of result.artifacts.entries()) {
            const source = within(workspace, resolve(cwd, reference));
            if (statSync(source).size > 10_000_000)
              throw new Error('Artifact exceeds 10 MB.');
            const name = `artifact-${index}`;
            writeFileSync(join(artifactDirectory, name), readFileSync(source), {
              mode: 0o600,
            });
            artifacts.push(name);
          }
          writeFileSync(
            join(artifactDirectory, 'result.json'),
            JSON.stringify(result),
            { mode: 0o600 },
          );
          artifacts.push('result.json');
          status = 'completed';
        } catch (failure) {
          error =
            failure instanceof Error
              ? failure.message
              : 'Invalid evaluation evidence.';
          result = null;
        }
      }
      done({ status, result, error, exitCode, artifacts });
    });
  });
  return {
    done,
    cancel() {
      if (closing || stop) return;
      stop = 'cancelled';
      kill();
    },
  };
}
