import { runCli } from './release/cli.js';
try {
  await runCli();
} catch (error) {
  console.error(`Paperloop could not start: ${error instanceof Error ? error.message : 'Unknown failure'}`);
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') console.error('This port is in use. Stop the other service or set PAPERLOOP_PORT to a free port.');
  if (code === 'EACCES') console.error('Check that you own the data directory and can read and write its files.');
  process.exitCode = 1;
}
