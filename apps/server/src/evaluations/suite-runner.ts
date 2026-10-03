import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  isEvaluationSuite,
  type EvaluationPlan,
  type SuiteCheckRecord,
  type EvaluationResult,
} from '@paperloop/contracts';
import { within } from '../experiments/workspaces.js';
import { EvaluationEvidenceStore } from './evidence-store.js';
import { fingerprint, WorkflowError } from './plan-service.js';
import { confirmProcessGroupStopped } from './process-group.js';
import {
  assessReport,
  parseCases,
  parseJUnit,
  parseMetrics,
  type ParsedReport,
  type CheckSpecification,
} from './report-adapters.js';
import {
  ArtifactRegistry,
  ARTIFACT_BYTES,
  clearReport,
  EvidenceError,
  readEvidence,
  REPORT_BYTES,
  RUN_LOG_BYTES,
} from './suite-files.js';

type EvaluationSuiteResult = Extract<EvaluationResult, { schemaVersion: 2 }>;
import { summarizeSuite } from './suite-summary.js';
type ParentStatus =
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted';
export interface SuiteExecution {
  cancel(): void;
  done: Promise<{
    status: ParentStatus;
    result: EvaluationSuiteResult;
    error: string | null;
    exitCode: null;
    artifacts: string[];
  }>;
}
interface ProcessResult {
  exitCode: number | null;
  stop: 'timed_out' | 'cancelled' | undefined;
  error: string | undefined;
  stopped: boolean;
  stdout: Buffer;
  stderr: Buffer;
  truncated: boolean;
}
// One bounded serial engine. Public experiment/automation entry points remain
// guarded until budget reservation and comparison integration are reviewed.
export function executeSuite(options: {
  plan: EvaluationPlan;
  runId: string;
  workspace: string;
  artifactDirectory: string;
  evidence: EvaluationEvidenceStore;
  // Must check the current exact approval and any live automation authorization.
  authorize(): void;
}): SuiteExecution {
  const { plan, runId, workspace, artifactDirectory, evidence } = options;
  const authorize = () => {
    evidence.requireActiveSuite(runId, plan.fingerprint);
    options.authorize();
  };
  if (
    !isEvaluationSuite(plan.configuration) ||
    !plan.approvedAt ||
    fingerprint(plan.configuration) !== plan.fingerprint
  )
    throw new Error(
      'Suite execution requires the exact approved configuration.',
    );
  const suite = plan.configuration;
  authorize();
  const initial = evidence.initialize(runId);
  if (
    initial.length !== suite.checks.length ||
    initial.some(
      (record, ordinal) =>
        record.result.status !== 'pending' ||
        record.specificationFingerprint !==
          fingerprint({ formatVersion: 2, check: suite.checks[ordinal] }),
    )
  )
    throw new Error(
      'An attempt cannot resume, repeat or use a different check specification.',
    );
  authorize();
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(artifactDirectory, 'attempt.json'),
    JSON.stringify({ runId, planFingerprint: plan.fingerprint }),
    { flag: 'wx', mode: 0o600 },
  );
  const artifacts = new ArtifactRegistry(artifactDirectory);
  const deadline = performance.now() + suite.overallTimeoutMs;
  let cancelled = false;
  let activeCancel: (() => void) | undefined;
  let retainedLogs = 0;
  const message = (error: unknown) =>
    error instanceof Error
      ? error.message
      : 'Evaluation infrastructure failed.';
  const processCheck = (
    check: CheckSpecification,
    cwd: string,
    timeoutMs: number,
  ): Promise<ProcessResult> =>
    new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: 'C.UTF-8',
      };
      for (const name of check.command.environmentReferences)
        if (process.env[name] !== undefined) env[name] = process.env[name];
      const child = spawn(check.command.executable, check.command.arguments, {
        cwd,
        env,
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let outBytes = 0,
        errBytes = 0;
      let truncated = false,
        closing = false;
      let stop: ProcessResult['stop'];
      let error: string | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const signal = (signal: NodeJS.Signals) => {
        if (child.pid) {
          try {
            process.kill(-child.pid, signal);
          } catch (failure) {
            if ((failure as NodeJS.ErrnoException).code !== 'ESRCH')
              error ??= message(failure);
          }
        }
      };
      const halt = (reason: NonNullable<ProcessResult['stop']>) => {
        if (closing || stop) return;
        stop = reason;
        signal('SIGTERM');
        killTimer = setTimeout(() => signal('SIGKILL'), 250);
      };
      activeCancel = () => halt('cancelled');
      const capture = (
        data: Buffer,
        stream: Buffer[],
        bytes: number,
      ): number => {
        const amount = Math.max(
          0,
          Math.min(
            data.length,
            1_000_000 - bytes,
            RUN_LOG_BYTES - retainedLogs,
          ),
        );
        if (amount < data.length) truncated = true;
        if (amount) {
          stream.push(Buffer.from(data.subarray(0, amount)));
          retainedLogs += amount;
        }
        return bytes + amount;
      };
      child.stdout.on('data', (data: Buffer) => {
        outBytes = capture(data, stdout, outBytes);
      });
      child.stderr.on('data', (data: Buffer) => {
        errBytes = capture(data, stderr, errBytes);
      });
      child.once('error', (failure) => {
        error = message(failure);
      });
      // A leader can exit while descendants keep its pipes open. Stop that group
      // immediately instead of waiting for the check timeout to release the pipes.
      child.once('exit', () => signal('SIGKILL'));
      const timeout = setTimeout(
        () => halt('timed_out'),
        Math.max(1, timeoutMs),
      );
      const authorization = setInterval(() => {
        try {
          authorize();
        } catch (failure) {
          error = message(failure);
          cancelled = true;
          halt('cancelled');
        }
      }, 100);
      child.once('close', async (exitCode) => {
        closing = true;
        activeCancel = undefined;
        clearTimeout(timeout);
        clearInterval(authorization);
        if (killTimer) clearTimeout(killTimer);
        signal('SIGKILL');
        const stopped =
          !child.pid || (await confirmProcessGroupStopped(child.pid));
        resolve({
          exitCode,
          stop,
          error,
          stopped,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          truncated,
        });
      });
      if (cancelled) halt('cancelled');
    });
  const done: SuiteExecution['done'] = Promise.resolve().then(async () => {
    let status: ParentStatus = 'completed';
    let error: string | null = null;
    const finish = (record: SuiteCheckRecord) =>
      evidence.update({
        ...record,
        finishedAt: new Date().toISOString(),
        durationMs: record.startedAt
          ? Math.max(0, Date.now() - Date.parse(record.startedAt))
          : null,
      });
    for (const original of initial) {
      if (status === 'completed' && cancelled) status = 'cancelled';
      if (status === 'completed' && performance.now() >= deadline)
        status = 'timed_out';
      if (status !== 'completed') {
        finish({
          ...original,
          result: {
            ...original.result,
            status: 'skipped',
            reason: `Parent evaluation ${status}; command was not started.`,
          },
        });
        continue;
      }
      try {
        authorize();
      } catch (failure) {
        cancelled = true;
        status = 'cancelled';
        error = message(failure);
        finish({
          ...original,
          result: { ...original.result, status: 'skipped', reason: error },
        });
        continue;
      }
      const check = original.specification;
      const blockedBy = check.dependsOn.filter(
        (id) =>
          evidence
            .checks(runId)
            .find((record) => record.specification.id === id)?.result.status !==
          'passed',
      );
      if (blockedBy.length) {
        finish({
          ...original,
          result: {
            ...original.result,
            status: 'skipped',
            blockedBy,
            reason: 'A prerequisite did not pass; command was not started.',
          },
        });
        continue;
      }
      let record = original;
      const references: string[] = [];
      let parsed: ParsedReport | undefined;
      try {
        const cwd = realpathSync(
          within(workspace, check.command.workingDirectory),
        );
        if (check.report.adapter !== 'exit-code')
          clearReport(workspace, cwd, check.report.path);
        if (check.report.adapter === 'metrics-v1' && check.report.cases)
          clearReport(workspace, cwd, check.report.cases.path);
        authorize();
        if (cancelled || performance.now() >= deadline) {
          status = cancelled ? 'cancelled' : 'timed_out';
          finish({
            ...record,
            result: {
              ...record.result,
              status: 'skipped',
              reason: `Parent evaluation ${status}; command was not started.`,
            },
          });
          continue;
        }
        record = evidence.update({
          ...record,
          startedAt: new Date().toISOString(),
          result: { ...record.result, status: 'running' },
        });
        const remaining = deadline - performance.now();
        const execution = await processCheck(
          check,
          cwd,
          Math.min(check.command.timeoutMs, remaining),
        );
        record = {
          ...record,
          logsTruncated: execution.truncated,
          result: { ...record.result, exitCode: execution.exitCode },
        };
        if (!execution.stopped) status = 'interrupted';
        for (const [suffix, bytes] of [
          ['stdout.log', execution.stdout],
          ['stderr.log', execution.stderr],
        ] as const) {
          const name = `${check.id}--${suffix}`;
          artifacts.register(name, bytes, true);
          references.push(name);
        }
        if (!execution.stopped) {
          status = 'interrupted';
          error =
            'Could not confirm the process group stopped. Reconcile surviving processes before retrying.';
          record.result = {
            ...record.result,
            status: 'interrupted',
            reason: error,
          };
        } else if (execution.stop) {
          record.result = {
            ...record.result,
            status: execution.stop,
            reason: execution.error ?? `Check ${execution.stop}.`,
          };
          if (execution.stop === 'cancelled') {
            status = 'cancelled';
            error = execution.error ?? 'Evaluation cancelled.';
          } else if (performance.now() >= deadline) {
            status = 'timed_out';
            error = 'Overall evaluation timeout reached.';
          }
        } else if (execution.error) {
          status = 'failed';
          error = execution.error;
          record.result = {
            ...record.result,
            status: 'unknown',
            reason: error,
          };
        } else {
          if (execution.exitCode !== 0)
            record.result = {
              ...record.result,
              status: 'failed',
              reason: `Command exited with code ${execution.exitCode}.`,
            };
          if (check.report.adapter === 'exit-code') {
            record.result = {
              ...record.result,
              status: execution.exitCode === 0 ? 'passed' : 'failed',
              evidenceStatus: 'valid',
            };
          } else {
            const bytes = readEvidence(
              workspace,
              cwd,
              check.report.path,
              REPORT_BYTES,
              Math.floor(Date.parse(record.startedAt!)),
            );
            const name = `${check.id}--report.${check.report.adapter === 'junit' ? 'xml' : 'json'}`;
            artifacts.register(name, bytes);
            references.push(name);
            parsed =
              check.report.adapter === 'junit'
                ? parseJUnit(bytes)
                : parseMetrics(bytes, check);
            if (check.report.adapter === 'metrics-v1' && check.report.cases) {
              const cases = readEvidence(
                workspace,
                cwd,
                check.report.cases.path,
                REPORT_BYTES,
                Math.floor(Date.parse(record.startedAt!)),
              );
              const name = `${check.id}--cases.json`;
              artifacts.register(name, cases);
              references.push(name);
              parsed.cases = parseCases(cases, record.datasetIdentity);
            }
            if (parsed.cases.length) {
              try {
                evidence.appendCases(runId, check.id, parsed.cases);
              } catch (failure) {
                if (
                  failure instanceof WorkflowError &&
                  failure.code === 'CASE_LIMIT'
                )
                  throw new EvidenceError('exceeds_limit', failure.message);
                throw failure;
              }
            }
            record.result = {
              ...record.result,
              ...assessReport(check, parsed),
              metrics: parsed.metrics,
              evidenceStatus: 'valid',
            };
            for (const [index, path] of parsed.artifacts.entries()) {
              const bytes = readEvidence(workspace, cwd, path, ARTIFACT_BYTES);
              const name = `${check.id}--artifact-${index}`;
              artifacts.register(name, bytes);
              references.push(name);
            }
          }
          if (execution.exitCode !== 0)
            record.result = {
              ...record.result,
              status: 'failed',
              reason: `Command exited with code ${execution.exitCode}.`,
            };
        }
      } catch (failure) {
        if (failure instanceof EvidenceError) {
          record.result = {
            ...record.result,
            status:
              status === 'interrupted'
                ? 'interrupted'
                : (record.result.exitCode !== null &&
                      record.result.exitCode !== 0) ||
                    record.result.status === 'failed'
                  ? 'failed'
                  : 'unknown',
            evidenceStatus: failure.evidenceStatus,
            reason: failure.message,
          };
        } else {
          if (status !== 'interrupted') status = 'failed';
          error = message(failure);
          record.result = {
            ...record.result,
            status: status === 'interrupted' ? 'interrupted' : 'unknown',
            reason: error,
          };
        }
      }
      record.result = { ...record.result, artifactReferences: references };
      finish(record);
    }
    if (status === 'completed' && cancelled) status = 'cancelled';
    if (status === 'completed' && performance.now() >= deadline) status = 'timed_out';
    return {
      status,
      result: summarizeSuite(evidence.checks(runId)),
      error,
      exitCode: null,
      artifacts: [...artifacts.references],
    };
  });
  return {
    cancel() {
      cancelled = true;
      activeCancel?.();
    },
    done,
  };
}
