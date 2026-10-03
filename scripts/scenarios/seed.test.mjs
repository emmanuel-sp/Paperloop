/* global process */
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../apps/server/dist/app.js';
import { seedScenarios } from './seed.mjs';

test('isolated scenarios persist real evidence, decisions and approval boundaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'paperloop-scenario-test-'));
  const options = {logger: false, dispatcher: false, settingsEnvironment: {}, connectionSecret: 'test-only', storage: {dataDirectory: join(root, 'data')}};
  let app = createApp(options);
  try {
    const manifest = await seedScenarios(app, join(root, 'fixtures'));
    assert.equal(manifest.projects.length, 2);
    const busy = manifest.projects.find(value => value.key === 'busy').id;
    const expected = ['improvement', 'regression', 'no_meaningful_change', 'regression', 'inconclusive', 'inconclusive', 'inconclusive'];
    assert.deepEqual(manifest.measurements.map(value => value.outcome), expected);
    assert.deepEqual(manifest.measurements.map(value => value.candidateStatus), ['completed', 'completed', 'completed', 'completed', 'failed', 'failed', 'timed_out']);
    const measured = manifest.measurements[0];
    const run = app.experiments.run(measured.candidateRunId);
    assert.equal(run.producer, 'harness');
    assert.equal(run.result.metrics[0].value, 0);
    assert.equal(run.result.metrics[0].samples.length, 300);
    const report = JSON.parse(app.experiments.artifact(run.id, 'artifact-0'));
    assert.equal(report.cases.length, 300);
    assert.ok(report.cases.every(value => value.predicted === value.expected && value.operations === 1));
    assert.throws(() => app.plans.requireApproved(manifest.planIds.draft), /Approve this exact/);
    assert.equal(app.discovery.triageHistory(busy, manifest.recommendationIds[0])[0].state, 'tested');
    const before = readFileSync(join(root, 'fixtures', 'manifest.json'), 'utf8');
    await assert.rejects(seedScenarios(app, join(root, 'fixtures')), /EEXIST/);
    assert.equal(readFileSync(join(root, 'fixtures', 'manifest.json'), 'utf8'), before);
    await app.close();
    app = createApp(options);
    assert.equal(app.experiments.detail(measured.experimentId).comparisons[0].outcome, 'improvement');
    assert.equal(app.experiments.detail(manifest.pendingExperimentId).experiment.status, 'pending');
    assert.equal(app.experiments.detail(manifest.readyExperimentId).experiment.status, 'ready');
    assert.equal(app.discovery.triageHistory(busy, manifest.recommendationIds[2])[0].state, 'dismissed');
    const schedules = app.schedules.list(busy).schedules;
    assert.ok(schedules.some(value => value.state === 'paused'));
    assert.ok(schedules.some(value => value.setup === 'failed'));
    assert.ok(schedules.every(value => value.externalTaskReference === null));
  } finally {
    await app.close();
    rmSync(root, {recursive: true, force: true});
  }
});


test('CLI refuses existing user data and seeds only the explicit fresh directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'paperloop-scenario-cli-'));
  try {
    const sentinel = join(root, 'sentinel.txt');
    writeFileSync(sentinel, 'user data');
    const run = (...args) => spawnSync(process.execPath, ['scripts/scenarios/load.mjs', ...args], {encoding: 'utf8', env: {...process.env, PAPERLOOP_DATA_DIR: root}});
    const refused = run(root, 'sparse');
    assert.notEqual(refused.status, 0);
    assert.equal(readFileSync(sentinel, 'utf8'), 'user data');
    assert.equal(existsSync(join(root, 'data')), false);
    const fresh = join(root, 'fresh');
    assert.notEqual(run(fresh, 'unknown').status, 0);
    assert.equal(existsSync(fresh), false);
    const loaded = run(fresh, 'sparse');
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(JSON.parse(readFileSync(join(fresh, 'manifest.json'), 'utf8')).projects.length, 1);
    assert.equal(existsSync(join(root, 'paperloop.sqlite')), false);
    assert.equal(existsSync(join(fresh, 'data', 'connection-secret')), true);
    assert.equal(loaded.stdout.includes(readFileSync(join(fresh, 'data', 'connection-secret'), 'utf8').trim()), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
