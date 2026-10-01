/* global process, console, URL */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createApp } from '../../apps/server/dist/app.js';
const root = mkdtempSync(join(tmpdir(), 'paperloop-browser-'));
const repository = join(root, 'repository');
execFileSync('git', ['init', repository]);
writeFileSync(join(repository, 'score.txt'), '10');
writeFileSync(
  join(repository, 'evaluate.py'),
  `import json, pathlib
value = float(pathlib.Path('score.txt').read_text())
pathlib.Path('result.json').write_text(json.dumps({'schemaVersion':1,'metrics':[{'name':'score','value':value,'unit':'points','samples':[value]}],'artifacts':[]}))
print('Python evaluation complete')
`,
);
execFileSync('git', ['-C', repository, 'add', '.']);
execFileSync('git', [
  '-C',
  repository,
  '-c',
  'user.name=Browser fixture',
  '-c',
  'user.email=browser@example.test',
  'commit',
  '-m',
  'fixture',
]);
const app = createApp({
  connectionSecret: 'browser-fixture-secret',
  logger: false,
  dispatcher: false,
  storage: { dataDirectory: join(root, 'data') },
  webRoot: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
});
const project = app.projects.create({
  name: 'Retrieval lab',
  description:
    'Improve retrieval quality while keeping response time predictable.',
  objectives: ['Improve answer grounding', 'Reduce irrelevant results'],
  constraints: ['Keep evaluation local', 'Preserve response time'],
  repository: { kind: 'local', path: repository },
});
const paper = app.research.ingest(project.id, {
  title: 'A focused retrieval technique',
  sourceKind: 'reference',
  sourceReference: 'Local evaluation fixture',
  extractionStatus: 'complete',
  extractedContent: 'Improve the score with a focused candidate change.',
  authors: ['Research team'],
  submittedBy: 'user',
});
app.discovery.storeRecommendation(project.id, {
  documentId: paper.id,
  title: 'Test a focused retrieval change',
  summary:
    'A small change could improve grounding. Measure it against the same dataset.',
  applicability: 'Matches the project objective.',
  prerequisites: ['Use an approved plan'],
  uncertainty: 'Source results may not transfer.',
  evaluationTargets: ['Compare the score'],
  sources: [
    {
      documentId: paper.id,
      claim: 'The technique improves retrieval.',
      evidence: 'Supplied fixture text.',
    },
  ],
  projectContextVersion: project.currentContext.version,
});
app.plans.draft(project.id, {
  name: 'Retrieval quality',
  datasetIdentity: 'fixture-v1',
  cases: ['sample-1'],
  metrics: [
    {
      name: 'score',
      unit: 'points',
      direction: 'increase',
      minimumImprovement: 1,
      maximumRegression: 0,
      minimumSamples: 1,
      guardrail: false,
    },
  ],
  command: {
    executable: 'python3',
    arguments: ['evaluate.py'],
    workingDirectory: '.',
    resultPath: 'result.json',
    timeoutMs: 10000,
    environmentReferences: [],
  },
  environmentIdentity: 'local-python',
});
// Test-only agent implementation; production routes do not include this endpoint.
app.post('/__test/implement/:id', async (request) => {
  const { id } = request.params;
  const detail = app.experiments.claim(id, 'browser-fixture-agent');
  writeFileSync(join(detail.experiment.candidatePath, 'score.txt'), '12');
  return app.experiments.progress(
    id,
    detail.experiment.claimToken,
    'Implemented the candidate in its isolated workspace.',
    true,
  );
});
await app.listen({ host: '127.0.0.1', port: 43187 });
console.log('Browser fixture ready');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
