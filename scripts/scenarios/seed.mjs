/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { scheduleConfigSchema } from '../../packages/contracts/dist/index.js';

// All content is synthetic; measurements are produced by the real local runner.
const harness = `import { readFileSync, writeFileSync } from 'node:fs';
const config = JSON.parse(readFileSync('model.json', 'utf8'));
if (config.mode === 'failure') throw new Error('Controlled demo failure');
if (config.mode === 'timeout') await new Promise(resolve => setTimeout(resolve, 3000));
const cases = Array.from({length: 300}, (_, i) => {
  const input = (i + 1) / 300;
  const expected = 2 * input;
  let predicted = 0;
  let operations = 0;
  for (let step = 0; step < config.operations; step++) {
    predicted = config.weight * input;
    operations++;
  }
  return {id: 'case-' + (i + 1), input, expected, predicted, operations, error: Math.abs(expected - predicted)};
});
const errors = cases.map(value => value.error);
writeFileSync('cases.json', JSON.stringify({syntheticDataset: true, cases}));
const metrics = [{name: 'mean_absolute_error', value: errors.reduce((a,b) => a+b, 0)/errors.length, unit: 'error', samples: errors}];
if (config.mode !== 'missing') metrics.push({name: 'operations', value: cases.reduce((sum, value) => sum + value.operations, 0)/cases.length, unit: 'per case', samples: cases.map(value => value.operations)});
writeFileSync('result.json', JSON.stringify({schemaVersion: 1, metrics, artifacts: ['cases.json']}));
`;

function repository(root) {
  const path = join(root, 'linear-model');
  mkdirSync(path); // Refuse reuse, including an existing user repository.
  writeFileSync(join(path, 'README.md'), '# Synthetic demo: linear model\n\nPredict y=2x on 300 deterministic synthetic cases. No real research or paid services.\n');
  writeFileSync(join(path, 'package.json'), JSON.stringify({type: 'module', scripts: {test: 'node evaluate.mjs'}}));
  writeFileSync(join(path, 'evaluate.mjs'), harness);
  writeFileSync(join(path, 'model.json'), JSON.stringify({weight: 1, operations: 1}));
  for (const args of [['init', '--initial-branch=main'], ['add', '.'], ['-c', 'user.name=Paperloop demo', '-c', 'user.email=demo@example.test', 'commit', '-m', 'Synthetic local model fixture']]) {
    execFileSync('git', ['-C', path, ...args], {stdio: 'pipe'});
  }
  return path;
}

async function settle(app, run) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const current = app.experiments.run(run.id);
    if (current.status !== 'running') return current;
    await delay(20);
  }
  app.experiments.cancel(run.id);
  throw new Error('Scenario run exceeded its ten-second fixture bound');
}

export async function seedScenarios(app, root, scenario = 'all') {
  if (!['all', 'sparse', 'busy', 'measured'].includes(scenario)) throw new Error('Unknown scenario');
  mkdirSync(root); // Callers must supply a fresh explicit directory.
  const manifest = {schemaVersion: 1, scenario, synthetic: true, projects: [], measurements: [], limitations: ['No live agent, native scheduler, provider call or real paper is represented.', 'Layered checks and per-case UI await #66; cases.json is a measured artifact using the legacy plan.']};
  if (['all', 'sparse'].includes(scenario)) {
    const empty = app.projects.create({name: '[Demo] Empty project', description: 'Synthetic sparse project for empty-state review.', objectives: [], constraints: []});
    manifest.projects.push({key: 'sparse', id: empty.id});
  }
  if (['all', 'busy', 'measured'].includes(scenario)) {
    const path = repository(root);
    const project = app.projects.create({name: '[Demo] Linear model research laboratory with a deliberately long project title', description: 'Synthetic project: compare a tiny linear model across 300 controlled cases. This long context exercises wrapping and populated workbench layouts. No source claim is a measured finding.', objectives: ['Reduce prediction error on the synthetic dataset', 'Preserve the operations guardrail'], constraints: ['No paid execution', 'Keep all evidence local'], repository: {kind: 'local', path}});
    manifest.projects.push({key: 'busy', id: project.id});
    const papers = [];
    const recommendations = [];
    for (let i = 0; i < 24; i++) {
      const paper = app.research.ingest(project.id, {title: `[Synthetic ${i + 1}] ${i === 0 ? 'A deliberately long research title about calibrated linear predictions, reproducible measurements, and practical evidence review across different application layouts' : 'Controlled linear prediction study'}`, sourceKind: 'reference', sourceReference: `synthetic:paperloop-demo:v1:${i}`, authors: ['Synthetic Demo Author'], extractionStatus: i === 23 ? 'unavailable' : 'complete', ...(i === 23 ? {extractionError: 'Controlled unavailable full text'} : {extractedContent: 'Synthetic claim: calibrating the weight may reduce prediction error. Validate locally; this is not a real paper.'}), submittedBy: 'user'});
      papers.push(paper);
      const recommendation = app.discovery.storeRecommendation(project.id, {documentId: paper.id, title: `[Synthetic] Calibrate prediction approach ${i + 1}`, summary: 'Synthetic proposal; measured evidence is available only in explicitly completed local experiments.', applicability: 'Matches the synthetic prediction objective.', prerequisites: ['Review the exact local evaluation command'], uncertainty: 'Synthetic results do not establish applicability to real models.', evaluationTargets: ['Mean absolute error', 'Operations guardrail'], sources: [{documentId: paper.id, claim: 'Calibration may help.', evidence: 'Synthetic supplied text, not a research result.'}], projectContextVersion: project.currentContext.version});
      recommendations.push(recommendation);
      if (i % 4 === 1 || i % 4 === 2) app.discovery.triage(project.id, recommendation.id, {state: i % 4 === 1 ? 'saved' : 'dismissed', reason: 'Synthetic persisted decision for demo review.'});
    }
    manifest.paperIds = papers.map(paper => paper.id);
    manifest.recommendationIds = recommendations.map(value => value.id);
    const configuration = {name: '[Demo] Prediction error and operations', datasetIdentity: 'synthetic-linear-300-v1', cases: Array.from({length: 300}, (_, i) => `case-${i + 1}`), metrics: [{name: 'mean_absolute_error', unit: 'error', direction: 'decrease', minimumImprovement: 0.01, maximumRegression: 0, minimumSamples: 300, guardrail: false}, {name: 'operations', unit: 'per case', direction: 'decrease', minimumImprovement: 0, maximumRegression: 0, minimumSamples: 300, guardrail: true}], command: {executable: process.execPath, arguments: ['evaluate.mjs'], workingDirectory: '.', resultPath: 'result.json', timeoutMs: 1000, environmentReferences: []}, environmentIdentity: `local-node-${process.versions.node}`};
    const approved = app.plans.draft(project.id, configuration);
    // Explicit fixture-only authorization, restricted to this generated repository.
    app.plans.approve(approved.id, approved.fingerprint);
    const draft = app.plans.draft(project.id, {...configuration, name: '[Demo] Draft awaiting review'});
    manifest.planIds = {approved: approved.id, draft: draft.id};
    if (['all', 'measured'].includes(scenario)) {
      const variants = [
        ['improvement', {weight: 2, operations: 1}],
        ['regression', {weight: 0.5, operations: 1}],
        ['no_meaningful_change', {weight: 1, operations: 1}],
        ['guardrail_regression', {weight: 2, operations: 2}],
        ['missing', {weight: 2, operations: 1, mode: 'missing'}],
        ['failure', {weight: 2, operations: 1, mode: 'failure'}],
        ['timeout', {weight: 2, operations: 1, mode: 'timeout'}],
      ];
      for (const [index, [key, model]] of variants.entries()) {
        const detail = app.experiments.create(project.id, {documentId: papers[index].id, planId: approved.id});
        const id = detail.experiment.id;
        const baseline = await settle(app, app.experiments.startRun(id, 'baseline'));
        if (baseline.status !== 'completed') throw new Error(`Baseline failed: ${baseline.error}`);
        const claimed = app.experiments.claim(id, 'synthetic-demo-agent');
        writeFileSync(join(claimed.experiment.candidatePath, 'model.json'), JSON.stringify(model));
        app.experiments.progress(id, claimed.experiment.claimToken, 'Simulated agent changed the generated local model. Evaluation is a real local run.', true, {summary: 'Synthetic candidate weight change.', changedFiles: ['model.json'], checks: [], limitations: ['Simulated implementation, no live coding agent.']});
        const candidate = await settle(app, app.experiments.startRun(id, 'candidate'));
        const comparison = app.experiments.compare(id, baseline.id, candidate.id);
        if (index === 0) app.discovery.triage(project.id, recommendations[0].id, {state: 'tested', reason: 'Real local measurement of a synthetic candidate.', experimentId: id});
        manifest.measurements.push({key, experimentId: id, baselineRunId: baseline.id, candidateRunId: candidate.id, candidateStatus: candidate.status, outcome: comparison.outcome, provenance: 'Real local node execution on synthetic data'});
      }
    }
    const pending = app.experiments.create(project.id, {documentId: papers[20].id, planId: approved.id});
    manifest.pendingExperimentId = pending.experiment.id;
    const ready = app.experiments.create(project.id, {documentId: papers[21].id, planId: approved.id});
    const claim = app.experiments.claim(ready.experiment.id, 'synthetic-demo-agent');
    app.experiments.progress(ready.experiment.id, claim.experiment.claimToken, 'Simulated ready state; not a measured result.', true);
    manifest.readyExperimentId = ready.experiment.id;
    const active = app.schedules.create(project.id, scheduleConfigSchema.parse({timezone: 'America/Los_Angeles', query: 'Synthetic linear model calibration'}));
    const paused = app.schedules.create(project.id, scheduleConfigSchema.parse({timezone: 'America/Los_Angeles', query: 'Synthetic operations guardrails'}));
    app.schedules.setState(paused.schedule.id, 'paused');
    const failed = app.schedules.create(project.id, scheduleConfigSchema.parse({timezone: 'America/Los_Angeles', query: 'Synthetic unavailable executor'}));
    app.schedules.checkIn(failed.schedule.id, failed.schedule.revision, undefined, 'failed', 'Synthetic setup failure: no native scheduler was invoked.');
    manifest.scheduleIds = {setupPending: active.schedule.id, paused: paused.schedule.id, failed: failed.schedule.id};
  }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
