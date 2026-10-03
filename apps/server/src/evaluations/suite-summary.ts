import type { EvaluationResult, SuiteCheckRecord } from '@paperloop/contracts';
export function summarizeSuite(
  records: SuiteCheckRecord[],
): Extract<EvaluationResult, { schemaVersion: 2 }> {
  const required = records.filter((record) => record.specification.required);
  return {
    schemaVersion: 2,
    requiredValidation: required.some(
      (record) => record.result.status === 'failed',
    )
      ? 'failed'
      : required.some((record) => record.result.status !== 'passed')
        ? 'unknown'
        : 'passed',
    checks: records.map((record) => record.result),
  };
}
