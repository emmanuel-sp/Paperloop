/* global process, console, fetch, setTimeout, URL, URLSearchParams */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const installation = resolve(process.argv[2] ?? 'release/paperloop');
const root = mkdtempSync(join(tmpdir(), 'paperloop-release-smoke-'));
const data = join(root, 'data');
const launcher = join(root, 'launcher');
const launchFile = join(root, 'launch-url');
mkdirSync(launcher);
// Exercise the real packaged CLI handoff without opening a CI desktop browser.
for (const executable of ['open', 'xdg-open']) {
  writeFileSync(join(launcher, executable), `#!/usr/bin/env node\nif (process.env.PAPERLOOP_SMOKE_LAUNCH_FAIL) process.exit(1);\nrequire('node:fs').writeFileSync(process.env.PAPERLOOP_SMOKE_LAUNCH_FILE, process.argv[2], { mode: 0o600 });\n`, { mode: 0o700 });
}
for (const match of readFileSync(
  join(installation, 'README.md'),
  'utf8',
).matchAll(/\]\(([^)]+\.md)\)/g))
  assert.ok(
    existsSync(join(installation, match[1])),
    `Missing bundled documentation: ${match[1]}`,
  );
const env = {
  ...process.env,
  PAPERLOOP_DATA_DIR: data,
  PAPERLOOP_PORT: '43189',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  PATH: `${launcher}:${process.env.PATH}`,
  WSL_DISTRO_NAME: '',
  WSL_INTEROP: '',
  PAPERLOOP_SMOKE_LAUNCH_FILE: launchFile,
};
let child;
let output = '';
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = once(child, 'exit');
  child.kill('SIGTERM');
  await done;
}
async function start(directory, { args = [], failLaunch = false, expectLaunch = true } = {}) {
  output = '';
  rmSync(launchFile, { force: true });
  child = spawn(process.execPath, ['server/dist/index.js', ...args], {
    cwd: installation,
    env: { ...env, PAPERLOOP_DATA_DIR: directory, PAPERLOOP_SMOKE_LAUNCH_FAIL: failLaunch ? '1' : '' },
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
      if (response.ok && (expectLaunch ? existsSync(launchFile) : output.includes('connect manually'))) return;
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
  const launchUrl = new URL(readFileSync(launchFile, 'utf8'));
  const launchToken = new URLSearchParams(launchUrl.hash.slice(1)).get('launch');
  assert.equal(launchUrl.origin, 'http://127.0.0.1:43189');
  assert.ok(launchToken && launchToken !== secret);
  assert.ok(!output.includes(launchToken), 'startup leaked the launch capability');
  const exchange = () => fetch(`${launchUrl.origin}/api/v1/session/launch`, {
    method: 'POST', headers: { origin: launchUrl.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token: launchToken }),
  });
  const session = await exchange();
  assert.equal(session.status, 204);
  assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await exchange()).status, 401);
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
  await stop();
  await start(backup, { args: ['--no-open'], expectLaunch: false });
  assert.ok(!existsSync(launchFile), '--no-open unexpectedly opened a browser');
  assert.match(output, /connect manually/);
  await stop();
  await start(backup, { failLaunch: true, expectLaunch: false });
  assert.match(output, /connect manually/);
  assert.equal((await fetch('http://127.0.0.1:43189/api/v1/projects', { headers })).status, 200);
  console.log(
    'Release smoke passed: installed UI/server, one-time browser handoff, persistence, backup, and restore.',
  );
} finally {
  await stop();
  rmSync(root, { recursive: true, force: true });
}
