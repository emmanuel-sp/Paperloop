/* global process, console */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../../apps/server/dist/app.js';
import { loadOrCreateConnectionSecret } from '../../apps/server/dist/runtime/connection-secret.js';
import { seedScenarios } from './seed.mjs';

const [directory, scenario = 'all', ...extra] = process.argv.slice(2);
if (!directory || extra.length || !['all', 'sparse', 'busy', 'measured'].includes(scenario)) {
  console.error('Usage: pnpm demo:seed <NEW-directory> [all|sparse|busy|measured]');
  process.exitCode = 1;
} else {
  const root = resolve(directory);
  // Atomic reservation refuses existing directories, symlinks and user data.
  mkdirSync(root, {mode: 0o700});
  const data = join(root, 'data');
  const credential = loadOrCreateConnectionSecret(data);
  const app = createApp({logger: false, dispatcher: false, settingsEnvironment: {}, connectionSecret: credential.value, storage: {dataDirectory: data}});
  try {
    const manifest = await seedScenarios(app, join(root, 'fixtures'), scenario);
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`Seeded synthetic scenario '${scenario}' in ${root}.`);
    console.log(`Use PAPERLOOP_DATA_DIR=${data} when launching this isolated instance. Connection credential remains in the data directory.`);
  } finally {
    await app.close();
  }
}
