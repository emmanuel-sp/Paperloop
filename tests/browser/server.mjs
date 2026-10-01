/* global process, console, URL */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scheduleConfigSchema } from '../../packages/contracts/dist/index.js';
import { createApp } from '../../apps/server/dist/app.js';
import { GithubAccessError } from '../../apps/server/dist/projects/github-service.js';
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
execFileSync('git', ['-C', repository, 'remote', 'add', 'origin', 'https://github.com/research-team/private-lab.git']);
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
let githubState = 'connected';
const githubRepos = ['private-lab', 'public-lab'].map((name) => ({
  name, owner: { login: 'research-team' }, full_name: `research-team/${name}`,
  description: 'Controlled GitHub repository fixture', private: name === 'private-lab',
  default_branch: 'main', permissions: { pull: true },
}));
const app = createApp({
  githubApi: async (endpoint) => {
    const failures = {
      disconnected: ['GITHUB_DISCONNECTED', 'Sign in with GitHub CLI on the computer running Paperloop, then retry.', 503],
      expired: ['GITHUB_EXPIRED', 'Your GitHub sign-in has expired. Sign in again, then retry.', 503],
      denied: ['GITHUB_ACCESS_DENIED', 'This GitHub connection cannot read the requested repository.', 403],
      limited: ['GITHUB_RATE_LIMITED', 'GitHub is limiting requests. Wait before retrying.', 429],
    };
    if (failures[githubState]) throw new GithubAccessError(...failures[githubState]);
    if (endpoint === '/user') return { login: 'fixture-user' };
    if (endpoint.startsWith('/user/repos')) return githubRepos;
    if (endpoint.startsWith('/search/')) {
      const query = new URL(`https://api.github.com${endpoint}`).searchParams.get('q');
      return { items: githubRepos.filter((repo) => repo.full_name.includes(query)) };
    }
    const repo = githubRepos.find((value) => endpoint === `/repos/${value.full_name}`);
    if (!repo) throw new GithubAccessError('GITHUB_ACCESS_DENIED', 'This GitHub connection cannot read the requested repository.', 403);
    return repo;
  },
  connectionSecret: 'browser-fixture-secret',
  logger: false,
  dispatcher: false,
  storage: { dataDirectory: join(root, 'data') },
  webRoot: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
});
app.post('/__test/github', async (request) => {
  githubState = request.body.state;
  return { repository };
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
const plan = app.plans.draft(project.id, {
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
// A bounded test-only fixture for independently reproducible populated review.
app.post('/__test/foundations', async () => {
  let detail = app.experiments
    .list(project.id)
    .map((item) => app.experiments.detail(item.id))
    .find((item) => item.comparisons.length);
  if (!detail) {
    app.plans.approve(plan.id, plan.fingerprint);
    const experiment = app.experiments.create(project.id, {
      documentId: paper.id,
      planId: plan.id,
    });
    const id = experiment.experiment.id;
    const settle = async (run) => {
      for (let attempt = 0; attempt < 500; attempt++) {
        const result = app.experiments.run(run.id);
        if (result.status !== 'running') {
          if (result.status !== 'completed')
            throw new Error(result.error ?? 'Fixture evaluation failed');
          return result;
        }
        await delay(20);
      }
      throw new Error('Fixture evaluation timed out');
    };
    const baseline = await settle(app.experiments.startRun(id, 'baseline'));
    const claimed = app.experiments.claim(id, 'foundation-fixture-agent');
    writeFileSync(join(claimed.experiment.candidatePath, 'score.txt'), '12');
    app.experiments.progress(
      id,
      claimed.experiment.claimToken,
      'Applied a synthetic test change in the isolated checkout.',
      true,
    );
    const candidate = await settle(app.experiments.startRun(id, 'candidate'));
    app.experiments.compare(id, baseline.id, candidate.id);
    detail = app.experiments.detail(id);
  }
  if (!app.schedules.list(project.id).schedules.length) {
    const value = app.schedules.create(
      project.id,
      scheduleConfigSchema.parse({ timezone: 'America/Los_Angeles' }),
    );
    app.schedules.setState(value.schedule.id, 'paused');
  }
  return {
    projectId: project.id,
    experimentId: detail.experiment.id,
    paperId: paper.id,
  };
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
