/* global console, URL */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'release', 'paperloop');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const [from, to] of [
  ['apps/server/dist', 'server/dist'],
  ['apps/server/drizzle', 'server/drizzle'],
  ['apps/web/dist', 'web/dist'],
  ['packages/contracts/dist', 'contracts/dist'],
  ['docs', 'docs'],
])
  cpSync(join(root, from), join(output, to), { recursive: true });
cpSync(
  join(root, 'packages/contracts/package.json'),
  join(output, 'contracts/package.json'),
);
writeFileSync(
  join(output, 'README.md'),
  readFileSync(join(root, 'docs/INSTALL.md'), 'utf8').replace(
    /\]\((agent-connections|EXPERIMENT_LOOP|SCHEDULING)\.md\)/g,
    '](docs/$1.md)',
  ),
);
const serverPackage = JSON.parse(
  readFileSync(join(root, 'apps/server/package.json'), 'utf8'),
);
const dependencies = Object.fromEntries(
  Object.keys(serverPackage.dependencies).map((name) => {
    if (name === '@paperloop/contracts') return [name, 'file:./contracts'];
    const installed = JSON.parse(
      readFileSync(
        join(root, 'apps/server/node_modules', name, 'package.json'),
        'utf8',
      ),
    );
    return [name, installed.version];
  }),
);
writeFileSync(
  join(output, 'package.json'),
  JSON.stringify(
    {
      name: 'paperloop-local',
      version: '0.1.0',
      private: true,
      type: 'module',
      engines: { node: '>=24.15 <25' },
      scripts: {
        start: 'node server/dist/index.js',
        doctor: 'node server/dist/index.js doctor',
        backup: 'node server/dist/index.js backup',
      },
      dependencies,
    },
    null,
    2,
  ) + '\n',
);
execFileSync(
  'npm',
  [
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ],
  { cwd: output, stdio: 'inherit' },
);
execFileSync('tar', [
  '-czf',
  resolve(root, 'release/paperloop-0.1.0.tar.gz'),
  '-C',
  join(root, 'release'),
  'paperloop',
]);
console.log(
  `Release: ${join(root, 'release/paperloop-0.1.0.tar.gz')}\nInstall dependencies on the target platform with npm ci --omit=dev.`,
);
