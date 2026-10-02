import { loadConfiguration } from '../runtime/configuration.js';
import { startServer } from '../runtime/server.js';
import { diagnostics, runtimeProblem } from './diagnostics.js';
import { backupData } from './backup.js';
import { openLocalBrowser } from '../runtime/browser-launch.js';
export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] === '--no-open' ? 'start' : args[0] ?? 'start';
  const startOptions = args[0] === '--no-open' ? args : args.slice(1);
  if (command === '--help' || command === 'help') {
    console.log(
      'Paperloop\n\nstart             Open the local service and workbench (default)\nstart --no-open   Start without opening a browser; connect manually\ndoctor            Check runtime, paths, Git, and Python without opening the database\nbackup DIRECTORY  Back up stopped application data to a new directory\n\nConfigure PAPERLOOP_DATA_DIR, PAPERLOOP_PORT, and provider keys in your environment.',
    );
    return;
  }
  if (!['start', 'doctor', 'backup'].includes(command))
    throw new Error(`Unknown command: ${command}. Run with --help.`);
  if (command === 'start' && startOptions.some((arg) => arg !== '--no-open'))
    throw new Error('Unknown start option. Run with --help.');
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
  const launchUrl = !args.includes('--no-open')
    ? server.browserLaunchUrl()
    : undefined;
  const opened = launchUrl ? await openLocalBrowser(launchUrl) : false;
  if (!opened) {
    server.cancelBrowserLaunch();
    console.log('Open the address above and connect manually using the local secret file.');
  } else {
    console.log(
      'Opened the workbench with a one-time local connection. If it does not open, use the address above and connect manually.',
    );
  }
  console.log('Press Ctrl+C to stop.');
}
