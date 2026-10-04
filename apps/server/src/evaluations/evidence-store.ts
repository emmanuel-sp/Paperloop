import { and, asc, count, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import {
  isEvaluationSuite,
  suiteCaseSchema,
  suiteCasePageRequestSchema,
  suiteCheckRecordSchema,
  type SuiteCheckRecord,
  type SuiteCase,
  type SuiteCasePageRequest,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import {
  evaluationPlans,
  evaluationRuns,
  evaluationRunChecks,
  evaluationRunCases,
} from '../storage/schema.js';
import { fingerprint, WorkflowError } from './plan-service.js';

const cursorSchema = z
  .object({
    version: z.literal(1),
    runId: z.uuid(),
    checkId: z.string(),
    status: suiteCaseSchema.shape.status.nullable(),
    after: z.number().int().nonnegative(),
  })
  .strict();
const terminal = (status: SuiteCheckRecord['result']['status']) =>
  !['pending', 'running'].includes(status);

// Only the harness may write evidence. HTTP/MCP expose the read methods below.
export class EvaluationEvidenceStore {
  constructor(private readonly database: PaperloopDatabase) {}

  private parent(runId: string) {
    const run = this.database.db
      .select()
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, runId))
      .get()?.payload;
    if (!run)
      throw new WorkflowError(
        'RUN_NOT_FOUND',
        'Evaluation run was not found.',
        404,
      );
    return run;
  }
  private approvedSuite(runId: string) {
    const run = this.parent(runId);
    const plan = this.database.db
      .select()
      .from(evaluationPlans)
      .where(eq(evaluationPlans.id, run.planId))
      .get();
    if (!plan || !isEvaluationSuite(plan.configuration))
      throw new WorkflowError(
        'SUITE_REQUIRED',
        'This run does not use a layered Evaluation.',
      );
    if (
      !plan.approvedAt ||
      fingerprint(plan.configuration) !== plan.fingerprint ||
      run.planFingerprint !== plan.fingerprint
    )
      throw new WorkflowError(
        'APPROVAL_REQUIRED',
        'The run must retain the exact approved suite fingerprint.',
      );
    if (
      run.datasetIdentity !== plan.configuration.datasetIdentity ||
      run.environmentIdentity !== plan.configuration.environmentIdentity
    )
      throw new WorkflowError(
        'PROVENANCE_MISMATCH',
        'Run provenance does not match the approved suite.',
      );
    return { run, suite: plan.configuration };
  }
  requireActiveSuite(runId: string, approvedFingerprint: string): void {
    const { run } = this.approvedSuite(runId);
    if (
      run.status !== 'running' ||
      run.producer !== 'harness' ||
      run.planFingerprint !== approvedFingerprint
    )
      throw new WorkflowError(
        'RUN_NOT_ACTIVE',
        'Execution requires an active reserved harness run with the exact approved suite.',
      );
  }
  checks(runId: string): SuiteCheckRecord[] {
    this.parent(runId);
    return this.database.db
      .select()
      .from(evaluationRunChecks)
      .where(eq(evaluationRunChecks.runId, runId))
      .orderBy(asc(evaluationRunChecks.ordinal))
      .all()
      .map((row) => row.payload);
  }
  private check(runId: string, checkId: string): SuiteCheckRecord {
    this.parent(runId);
    const record = this.database.db
      .select()
      .from(evaluationRunChecks)
      .where(
        and(
          eq(evaluationRunChecks.runId, runId),
          eq(evaluationRunChecks.checkId, checkId),
        ),
      )
      .get()?.payload;
    if (!record)
      throw new WorkflowError(
        'CHECK_NOT_FOUND',
        'The check was not found in this run.',
        404,
      );
    return record;
  }
  initialize(runId: string): SuiteCheckRecord[] {
    return this.database.db.transaction((tx) => {
      const { run, suite } = this.approvedSuite(runId);
      if (run.status !== 'running')
        throw new WorkflowError(
          'RUN_NOT_ACTIVE',
          'Only an active parent run may initialize checks.',
        );
      const existing = this.checks(runId);
      if (existing.length) return existing;
      const records = suite.checks.map((specification, ordinal) =>
        suiteCheckRecordSchema.parse({
          runId,
          ordinal,
          specification,
          specificationFingerprint: fingerprint({
            formatVersion: 2,
            check: specification,
          }),
          datasetIdentity:
            specification.datasetIdentity ?? suite.datasetIdentity,
          environmentIdentity:
            specification.environmentIdentity ?? suite.environmentIdentity,
          producerIdentity: run.producerIdentity,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          logsTruncated: false,
          result: {
            checkId: specification.id,
            status: 'pending',
            exitCode: null,
            evidenceStatus: 'not_produced',
            metrics: [],
            caseCoverage: 'unknown',
            caseCount: null,
            artifactReferences: [],
          },
        }),
      );
      for (const record of records)
        tx.insert(evaluationRunChecks)
          .values({
            runId,
            checkId: record.specification.id,
            ordinal: record.ordinal,
            payload: record,
          })
          .run();
      return records;
    });
  }
  update(record: SuiteCheckRecord): SuiteCheckRecord {
    const parsed = suiteCheckRecordSchema.parse(record);
    return this.database.db.transaction((tx) => {
      const { run, suite } = this.approvedSuite(parsed.runId);
      const specification = suite.checks[parsed.ordinal];
      if (
        !specification ||
        specification.id !== parsed.result.checkId ||
        fingerprint({ formatVersion: 2, check: specification }) !==
          parsed.specificationFingerprint ||
        fingerprint({ formatVersion: 2, check: parsed.specification }) !==
          parsed.specificationFingerprint ||
        parsed.datasetIdentity !==
          (specification.datasetIdentity ?? suite.datasetIdentity) ||
        parsed.environmentIdentity !==
          (specification.environmentIdentity ?? suite.environmentIdentity) ||
        parsed.producerIdentity !== run.producerIdentity
      )
        throw new WorkflowError(
          'CHECK_CHANGED',
          'Check evidence must retain its approved specification and provenance.',
        );
      const previous = this.check(parsed.runId, parsed.result.checkId);
      if (run.status !== 'running' || terminal(previous.result.status))
        throw new WorkflowError(
          'EVIDENCE_CLOSED',
          'Completed evidence is immutable.',
        );
      const immutable = (value: SuiteCheckRecord) => ({
        formatVersion: 2,
        runId: value.runId,
        ordinal: value.ordinal,
        specification: value.specification,
        specificationFingerprint: value.specificationFingerprint,
        datasetIdentity: value.datasetIdentity,
        environmentIdentity: value.environmentIdentity,
        producerIdentity: value.producerIdentity,
      });
      if (fingerprint(immutable(previous)) !== fingerprint(immutable(parsed)))
        throw new WorkflowError(
          'CHECK_CHANGED',
          'Check evidence must retain its approved specification and provenance.',
        );
      if (
        parsed.result.status === 'pending' &&
        previous.result.status === 'running'
      )
        throw new WorkflowError(
          'INVALID_CHECK_TRANSITION',
          'A running check cannot return to pending.',
        );
      if (
        parsed.result.status === 'running' &&
        (!parsed.startedAt || parsed.finishedAt)
      )
        throw new WorkflowError(
          'INVALID_CHECK_TIMING',
          'A running check requires a start time and no finish time.',
        );
      if (terminal(parsed.result.status) && !parsed.finishedAt)
        throw new WorkflowError(
          'INVALID_CHECK_TIMING',
          'Terminal check evidence requires a finish time.',
        );
      if (
        previous.workspaceObservations &&
        (fingerprint(previous.workspaceObservations.before) !==
          fingerprint(parsed.workspaceObservations?.before) ||
          (previous.workspaceObservations.after !== null &&
            fingerprint(previous.workspaceObservations.after) !==
              fingerprint(parsed.workspaceObservations?.after)))
      )
        throw new WorkflowError(
          'PROVENANCE_CHANGED',
          'Observed workspace evidence cannot be replaced after it is recorded.',
        );
      if (previous.startedAt && parsed.startedAt !== previous.startedAt)
        throw new WorkflowError(
          'INVALID_CHECK_TIMING',
          'The original start time must be retained.',
        );
      if (
        parsed.startedAt &&
        parsed.finishedAt &&
        Date.parse(parsed.finishedAt) < Date.parse(parsed.startedAt)
      )
        throw new WorkflowError(
          'INVALID_CHECK_TIMING',
          'Finish time precedes start time.',
        );
      if (parsed.result.caseCoverage === 'complete') {
        const total = tx
          .select({ total: count() })
          .from(evaluationRunCases)
          .where(
            and(
              eq(evaluationRunCases.runId, parsed.runId),
              eq(evaluationRunCases.checkId, parsed.result.checkId),
            ),
          )
          .get()!.total;
        if (parsed.result.caseCount !== total)
          throw new WorkflowError(
            'CASE_COUNT_MISMATCH',
            'Complete coverage must match stored case evidence.',
          );
      }
      tx.update(evaluationRunChecks)
        .set({ payload: parsed })
        .where(
          and(
            eq(evaluationRunChecks.runId, parsed.runId),
            eq(evaluationRunChecks.checkId, parsed.result.checkId),
          ),
        )
        .run();
      return parsed;
    });
  }
  appendCases(runId: string, checkId: string, input: SuiteCase[]): void {
    const cases = z.array(suiteCaseSchema).max(10000).parse(input);
    if (Buffer.byteLength(JSON.stringify(cases)) > 2_000_000)
      throw new WorkflowError(
        'CASE_LIMIT',
        'Case batch exceeds the 2 MB report bound.',
      );
    this.database.db.transaction((tx) => {
      const { run } = this.approvedSuite(runId);
      const check = this.check(runId, checkId);
      if (run.status !== 'running' || check.result.status !== 'running')
        throw new WorkflowError(
          'EVIDENCE_CLOSED',
          'Only a running check may append cases.',
        );
      const checkWhere = and(
        eq(evaluationRunCases.runId, runId),
        eq(evaluationRunCases.checkId, checkId),
      );
      const checkCount = tx
        .select({ total: count() })
        .from(evaluationRunCases)
        .where(checkWhere)
        .get()!.total;
      const runCount = tx
        .select({ total: count() })
        .from(evaluationRunCases)
        .where(eq(evaluationRunCases.runId, runId))
        .get()!.total;
      if (checkCount + cases.length > 10000 || runCount + cases.length > 50000)
        throw new WorkflowError(
          'CASE_LIMIT',
          'Case evidence exceeds the check or run bound.',
        );
      const seen = new Set(
        tx
          .select({ id: evaluationRunCases.caseId })
          .from(evaluationRunCases)
          .where(checkWhere)
          .all()
          .map((row) => row.id),
      );
      for (const [index, item] of cases.entries()) {
        if (seen.has(item.id))
          throw new WorkflowError(
            'DUPLICATE_CASE',
            'Case IDs must be unique within a check.',
          );
        seen.add(item.id);
        tx.insert(evaluationRunCases)
          .values({
            runId,
            checkId,
            ordinal: checkCount + index,
            caseId: item.id,
            status: item.status,
            payload: item,
          })
          .run();
      }
    });
  }
  cases(runId: string, checkId: string, input: SuiteCasePageRequest) {
    this.check(runId, checkId);
    const query = suiteCasePageRequestSchema.parse(input);
    let after = -1;
    if (query.cursor) {
      try {
        const cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
        if (
          cursor.runId !== runId ||
          cursor.checkId !== checkId ||
          cursor.status !== (query.status ?? null)
        )
          throw new Error('Cursor context differs.');
        after = cursor.after;
      } catch {
        throw new WorkflowError(
          'INVALID_CURSOR',
          'Use a cursor from the same run, check, and status filter.',
          400,
        );
      }
    }
    const where = and(
      eq(evaluationRunCases.runId, runId),
      eq(evaluationRunCases.checkId, checkId),
      query.status ? eq(evaluationRunCases.status, query.status) : undefined,
    );
    const total = this.database.db
      .select({ total: count() })
      .from(evaluationRunCases)
      .where(where)
      .get()!.total;
    const rows = this.database.db
      .select()
      .from(evaluationRunCases)
      .where(and(where, gt(evaluationRunCases.ordinal, after)))
      .orderBy(asc(evaluationRunCases.ordinal))
      .limit(query.limit + 1)
      .all();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      runId,
      checkId,
      total,
      cases: page.map((row) => row.payload),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                runId,
                checkId,
                status: query.status ?? null,
                after: last.ordinal,
              }),
            ).toString('base64url')
          : null,
    };
  }
  interrupt(runId: string, finishedAt: string): void {
    // Recovery preserves terminal checks and every case; it never retries a command.
    for (const previous of this.checks(runId)) {
      if (terminal(previous.result.status)) continue;
      const storedCases = this.database.db
        .select({ total: count() })
        .from(evaluationRunCases)
        .where(
          and(
            eq(evaluationRunCases.runId, runId),
            eq(evaluationRunCases.checkId, previous.result.checkId),
          ),
        )
        .get()!.total;
      const payload: SuiteCheckRecord = {
        ...previous,
        finishedAt,
        durationMs: previous.startedAt
          ? Math.max(0, Date.parse(finishedAt) - Date.parse(previous.startedAt))
          : null,
        result: {
          ...previous.result,
          status: 'interrupted',
          caseCount: storedCases || previous.result.caseCount,
          caseCoverage: storedCases ? 'partial' : previous.result.caseCoverage,
          reason:
            'Service restarted; reconcile the parent experiment before a new full run.',
        },
      };
      this.database.db
        .update(evaluationRunChecks)
        .set({ payload })
        .where(
          and(
            eq(evaluationRunChecks.runId, runId),
            eq(evaluationRunChecks.checkId, previous.result.checkId),
          ),
        )
        .run();
    }
  }
}
