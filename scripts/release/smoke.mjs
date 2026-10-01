/* global process, console, fetch, setTimeout */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const installation = resolve(process.argv[2] ?? 'release/paperloop');
const root = mkdtempSync(join(tmpdir(), 'paperloop-release-smoke-'));
const data = join(root, 'data');
const env = {
  ...process.env,
  PAPERLOOP_DATA_DIR: data,
  PAPERLOOP_PORT: '43189',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
};
let child;
let output = '';
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = once(child, 'exit');
  child.kill('SIGTERM');
  await done;
}
async function start(directory) {
  output = '';
  child = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: installation,
    env: { ...env, PAPERLOOP_DATA_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (bytes) => {
    output += bytes;
  });
  child.stderr.on('data', (bytes) => {
    output += bytes;
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch('http://127.0.0.1:43189/api/v1/health');
      if (response.ok) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Packaged service did not start: ${output}`);
}
async function command(args) {
  const task = spawn(process.execPath, ['server/dist/index.js', ...args], {
    cwd: installation,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  task.stdout.on('data', (bytes) => {
    text += bytes;
  });
  task.stderr.on('data', (bytes) => {
    text += bytes;
  });
  const [code] = await once(task, 'exit');
  assert.equal(code, 0, text);
  return text;
}
try {
  assert.match(await command(['doctor']), /Workbench:/);
  await start(data);
  const ui = await fetch('http://127.0.0.1:43189/');
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /<div id="root">/);
  const secret = readFileSync(join(data, 'connection-secret'), 'utf8').trim();
  assert.ok(!output.includes(secret), 'startup leaked the credential');
  const headers = {
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
  };
  const response = await fetch('http://127.0.0.1:43189/api/v1/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Release smoke project',
      description: 'Packaged app',
      objectives: [],
      constraints: [],
    }),
  });
  assert.equal(response.status, 201);
  const project = await response.json();
  await stop();
  const backup = join(root, 'backup');
  assert.match(await command(['backup', backup]), /Backup saved/);
  await start(backup);
  const restored = await fetch(
    `http://127.0.0.1:43189/api/v1/projects/${project.id}`,
    { headers },
  );
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).name, 'Release smoke project');
  console.log(
    'Release smoke passed: installed UI/server, startup, persistence, backup, and restore.',
  );
} finally {
  await stop();
  rmSync(root, { recursive: true, force: true });
}
