import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadConfiguration,
  type ServerConfiguration,
} from '../runtime/configuration.js';
export function runtimeProblem(
  version = process.versions.node,
  platform = process.platform,
): string | undefined {
  if (
    Number(version.split('.')[0]) !== 24 ||
    Number(version.split('.')[1]) < 15
  )
    return `Node.js 24.15 or newer within Node 24 is required; found ${version}. Install the latest Node.js 24 and reinstall dependencies.`;
  if (!['linux', 'darwin'].includes(platform))
    return 'Use Linux, macOS, or WSL2. On Windows, install and run Paperloop inside WSL2.';
  return undefined;
}
export function diagnostics(
  configuration: ServerConfiguration = loadConfiguration(),
): string[] {
  const problem = runtimeProblem();
  if (problem) throw new Error(problem);
  const lines = [
    `Node.js ${process.versions.node} · ${process.platform}/${process.arch}`,
    `Data directory: ${configuration.dataDirectory}`,
    `Listen: http://${configuration.host === '::1' ? '[::1]' : configuration.host}:${configuration.port}`,
  ];
  const migrations = fileURLToPath(
    new URL('../../drizzle/meta/_journal.json', import.meta.url),
  );
  if (!existsSync(migrations))
    throw new Error(
      'Database migrations are missing. Rebuild or reinstall the complete Paperloop bundle.',
    );
  if (
    configuration.webRoot &&
    existsSync(`${configuration.webRoot}/index.html`)
  )
    lines.push(`Workbench: ${configuration.webRoot}`);
  else
    lines.push(
      'Workbench is missing. Run pnpm build or install the complete release bundle.',
    );
  for (const executable of ['git', 'python3']) {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    lines.push(
      result.status === 0
        ? `${executable}: ${(result.stdout || result.stderr).trim()}`
        : `${executable}: unavailable; install it before using ${executable === 'git' ? 'Git experiments' : 'Python evaluations'}.`,
    );
  }
  lines.push(
    'Provider keys: configured through the environment; paid analysis stays disabled until approved in the workbench.',
  );
  return lines;
}
