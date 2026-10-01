import { loadConfiguration } from '../runtime/configuration.js';
import { startServer } from '../runtime/server.js';
import { diagnostics, runtimeProblem } from './diagnostics.js';
import { backupData } from './backup.js';
export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? 'start';
  if (command === '--help' || command === 'help') {
    console.log(
      'Paperloop\n\nstart             Open the local service and workbench (default)\ndoctor            Check runtime, paths, Git, and Python without opening the database\nbackup DIRECTORY  Back up stopped application data to a new directory\n\nConfigure PAPERLOOP_DATA_DIR, PAPERLOOP_PORT, and provider keys in your environment.',
    );
    return;
  }
  if (!['start', 'doctor', 'backup'].includes(command))
    throw new Error(`Unknown command: ${command}. Run with --help.`);
  const problem = runtimeProblem();
  if (problem) throw new Error(problem);
  const configuration = loadConfiguration();
  if (command === 'backup') {
    if (!args[1])
      throw new Error(
        'Supply a new destination directory: paperloop backup DIRECTORY. Stop the service first.',
      );
    console.log(
      `Backup saved: ${await backupData(configuration.dataDirectory, args[1])}`,
    );
    return;
  }
  for (const line of diagnostics(configuration)) console.log(line);
  if (command === 'doctor') return;
  const server = await startServer({ configuration });
  console.log(`\nPaperloop ready at ${server.address}`);
  console.log(`Connection secret file: ${server.connectionSecretPath}`);
  console.log(
    'Paste its contents into the workbench to connect. Press Ctrl+C to stop.',
  );
}
