import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  legacyEvaluationResultSchema,
  suiteCasesReportSchema,
  suiteCaseSchema,
  type EvaluationSuiteDraft,
  type SuiteCase,
  type SuiteCheckResult,
} from '@paperloop/contracts';
import { EvidenceError, REPORT_BYTES } from './suite-files.js';
export type CheckSpecification = EvaluationSuiteDraft['checks'][number];
export interface ParsedReport {
  cases: SuiteCase[];
  metrics: SuiteCheckResult['metrics'];
  artifacts: string[];
}
function malformed(message: string): never {
  throw new EvidenceError('malformed', message);
}
function json(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError)
      malformed('The report is not valid JSON.');
    throw error;
  }
}
export function parseMetrics(
  bytes: Buffer,
  check: CheckSpecification,
): ParsedReport {
  if (bytes.length > REPORT_BYTES)
    throw new EvidenceError('exceeds_limit', 'Metric report exceeds 2 MB.');
  const parsed = legacyEvaluationResultSchema.safeParse(json(bytes));
  if (!parsed.success)
    malformed('The metric report does not match metrics-v1.');
  const report = parsed.data;
  for (const criterion of check.metrics) {
    const metric = report.metrics.find((item) => item.name === criterion.name);
    if (
      !metric ||
      metric.unit !== criterion.unit ||
      (metric.samples?.length ?? 1) < criterion.minimumSamples
    )
      malformed(
        `Missing, incompatible or insufficient evidence for metric ${criterion.name}.`,
      );
  }
  return { cases: [], metrics: report.metrics, artifacts: report.artifacts };
}
export function parseCases(
  bytes: Buffer,
  datasetIdentity: string,
): SuiteCase[] {
  if (bytes.length > REPORT_BYTES)
    throw new EvidenceError('exceeds_limit', 'Case report exceeds 2 MB.');
  const parsed = suiteCasesReportSchema.safeParse(json(bytes));
  if (!parsed.success)
    malformed(
      'The case report does not match cases-v1 or has duplicate case IDs.',
    );
  if (parsed.data.datasetIdentity !== datasetIdentity)
    malformed('Case report dataset identity differs from the approved check.');
  return parsed.data.cases;
}
interface XmlNode {
  [key: string]: unknown;
}
function nodes(value: unknown): XmlNode[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((node) =>
    typeof node === 'object' && node !== null ? (node as XmlNode) : {},
  );
}
function attribute(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') malformed(`Invalid JUnit ${name} attribute.`);
  // Decode only built-in XML entities and character references. DTD/entity
  // declarations are prohibited before parsing; no resources are resolved.
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    (entity) => {
      const builtins: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
      };
      if (builtins[entity] !== undefined) return builtins[entity]!;
      const code = entity.startsWith('&#x')
        ? parseInt(entity.slice(3, -1), 16)
        : Number(entity.slice(2, -1));
      if (
        !Number.isSafeInteger(code) ||
        code < 1 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        malformed('Invalid XML character reference.');
      return String.fromCodePoint(code);
    },
  );
}
function bounded(value: string, name: string): string {
  if (!value.trim() || value.length > 2000)
    malformed(`JUnit ${name} must contain bounded nonempty text.`);
  return value;
}
function preflight(xml: string) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
    malformed('JUnit DTD and entity declarations are not supported.');
  let depth = 0;
  const tokens =
    /<(?:!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|\?[\s\S]*?\?|(?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  for (const match of xml.matchAll(tokens)) {
    const token = match[0];
    if (
      token.startsWith('<?') ||
      token.startsWith('<!--') ||
      token.startsWith('<![CDATA[')
    )
      continue;
    if (token.startsWith('<!')) malformed('Unsupported XML declaration.');
    if (token.startsWith('</')) depth--;
    else if (!token.endsWith('/>')) depth++;
    if (depth > 32) malformed('JUnit nesting exceeds 32 levels.');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true)
    malformed('The JUnit report is not well-formed XML.');
}
export function parseJUnit(bytes: Buffer): ParsedReport {
  if (bytes.length > REPORT_BYTES)
    throw new EvidenceError('exceeds_limit', 'JUnit report exceeds 2 MB.');
  const xml = bytes.toString('utf8');
  preflight(xml);
  const root = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: false,
    trimValues: false,
  }).parse(xml) as XmlNode;
  if (
    Object.keys(root).some(
      (key) => !['testsuite', 'testsuites', '?xml'].includes(key),
    )
  )
    malformed('JUnit must have exactly one supported root.');
  const cases: SuiteCase[] = [];
  const occurrences = new Map<string, SuiteCase[]>();
  interface Totals {
    tests: number;
    failures: number;
    errors: number;
    skipped: number;
  }
  const zero = (): Totals => ({ tests: 0, failures: 0, errors: 0, skipped: 0 });
  function validateTotals(node: XmlNode, totals: Totals) {
    for (const key of ['tests', 'failures', 'errors', 'skipped'] as const) {
      const declared = attribute(node, key);
      if (
        declared !== undefined &&
        (!/^\d+$/.test(declared) || Number(declared) !== totals[key])
      )
        malformed(`JUnit ${key} total is inconsistent with case evidence.`);
    }
  }
  function walk(
    node: XmlNode,
    parents: string[],
    index: number,
    container = false,
  ): Totals {
    if (
      Object.keys(node).some(
        (key) =>
          !key.startsWith('@_') &&
          ![
            'testcase',
            'testsuite',
            'properties',
            'system-out',
            'system-err',
            '#text',
          ].includes(key),
      )
    )
      malformed('Unsupported JUnit suite structure.');
    const totals = zero();
    const path = container
      ? parents
      : [
          ...parents,
          bounded(
            attribute(node, 'name') ?? `unnamed-suite-${index}`,
            'suite name',
          ),
        ];
    const suiteId = bounded(JSON.stringify(path), 'suite identity');
    for (const item of nodes(node.testcase)) {
      if (cases.length >= 10000)
        throw new EvidenceError(
          'exceeds_limit',
          'JUnit report exceeds 10,000 cases.',
        );
      if (
        Object.keys(item).some(
          (key) =>
            !key.startsWith('@_') &&
            ![
              'failure',
              'error',
              'skipped',
              'properties',
              'system-out',
              'system-err',
              '#text',
            ].includes(key),
        )
      )
        malformed('Unsupported JUnit case outcome structure.');
      const name = bounded(attribute(item, 'name') ?? '', 'case name');
      const className = attribute(item, 'classname') ?? '';
      const file = attribute(item, 'file') ?? '';
      if (className.length > 2000 || file.length > 2000)
        malformed('JUnit raw identifier exceeds its text bound.');
      const declaredStatus = attribute(item, 'status');
      if (
        declaredStatus !== undefined &&
        !['run', 'passed'].includes(declaredStatus)
      )
        malformed('Unsupported explicit JUnit case status.');
      const failed = item.failure !== undefined;
      const errored = item.error !== undefined;
      const skipped = item.skipped !== undefined;
      if (Number(failed) + Number(errored) + Number(skipped) > 1)
        malformed('JUnit case contains conflicting outcomes.');
      const key = JSON.stringify([path, className, file, name]);
      const previous = occurrences.get(key) ?? [];
      const reasonNode = nodes(item.failure ?? item.error ?? item.skipped)[0];
      const reason = reasonNode ? attribute(reasonNode, 'message') : undefined;
      const parsed = suiteCaseSchema.safeParse({
        id: createHash('sha256')
          .update(JSON.stringify([key, previous.length]))
          .digest('hex'),
        label: name,
        suiteId,
        status: failed || errored ? 'failed' : skipped ? 'skipped' : 'passed',
        rawIdentifiers: [suiteId, className, file, name],
        ...(reason?.trim() ? { reason: reason.slice(0, 2000) } : {}),
      });
      if (!parsed.success)
        malformed(
          'JUnit case cannot be represented by the bounded case contract.',
        );
      const value = parsed.data;
      previous.push(value);
      occurrences.set(key, previous);
      cases.push(value);
      totals.tests++;
      if (failed) totals.failures++;
      if (errored) totals.errors++;
      if (skipped) totals.skipped++;
    }
    for (const [childIndex, child] of nodes(node.testsuite).entries()) {
      const sub = walk(child, path, childIndex);
      for (const key of ['tests', 'failures', 'errors', 'skipped'] as const)
        totals[key] += sub[key];
    }
    validateTotals(node, totals);
    return totals;
  }
  if (root.testsuites !== undefined && root.testsuite !== undefined)
    malformed('JUnit must have one root container.');
  if (root.testsuites !== undefined) {
    const containers = nodes(root.testsuites);
    if (containers.length !== 1)
      malformed('JUnit must have one root container.');
    walk(containers[0]!, [], 0, true);
  } else if (root.testsuite !== undefined) {
    const suites = nodes(root.testsuite);
    if (suites.length !== 1) malformed('JUnit must have one root suite.');
    walk(suites[0]!, [], 0);
  } else malformed('JUnit requires a testsuite or testsuites root.');
  if (!cases.length) malformed('JUnit report contains no case evidence.');
  for (const values of occurrences.values())
    if (values.length > 1)
      for (const value of values) value.identityStatus = 'ambiguous';
  return { cases, metrics: [], artifacts: [] };
}
export function assessReport(
  check: CheckSpecification,
  report: ParsedReport,
): Pick<SuiteCheckResult, 'status' | 'caseCoverage' | 'caseCount' | 'reason'> {
  const cases = report.cases;
  let caseCoverage: SuiteCheckResult['caseCoverage'] = cases.length
    ? 'complete'
    : 'unknown';
  const gaps: string[] = [];
  if (cases.some((item) => item.status === 'unknown')) {
    caseCoverage = 'unknown';
    gaps.push('Some cases have unknown outcomes.');
  }
  if (
    cases.some((item) => item.status === 'skipped') &&
    check.coverage?.skippedCases !== 'allow'
  ) {
    caseCoverage = 'partial';
    gaps.push('Some cases did not execute.');
  }
  if (check.coverage) {
    if (cases.length < check.coverage.minimumCases) {
      caseCoverage = 'partial';
      gaps.push('Fewer cases ran than the approved coverage requires.');
    }
    if (check.coverage.suiteIds.length) {
      const actual = new Set(cases.map((item) => item.suiteId));
      if (
        check.coverage.suiteIds.some((id) => !actual.has(id)) ||
        [...actual].some((id) => !id || !check.coverage!.suiteIds.includes(id))
      ) {
        caseCoverage = 'partial';
        gaps.push('Reported suites differ from the approved coverage.');
      }
    }
  }
  if (cases.some((item) => item.identityStatus !== 'stable')) {
    caseCoverage = 'unknown';
    gaps.push('Case identities are ambiguous.');
  }
  if (cases.some((item) => item.status === 'unknown')) caseCoverage = 'unknown';
  const failed = cases.some((item) => item.status === 'failed');
  const coverageRequired =
    check.report.adapter === 'junit' || Boolean(check.coverage);
  return {
    status: failed
      ? 'failed'
      : coverageRequired && caseCoverage !== 'complete'
        ? 'unknown'
        : cases.some((item) => item.status === 'skipped') &&
            check.coverage?.skippedCases !== 'allow'
          ? 'unknown'
          : 'passed',
    caseCoverage,
    caseCount: cases.length ? cases.length : null,
    ...(failed
      ? { reason: 'Reported cases include failures.' }
      : gaps.length
        ? { reason: gaps.join(' ') }
        : {}),
  };
}
