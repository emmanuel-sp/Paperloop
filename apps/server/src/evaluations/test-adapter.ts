// Runs only as part of an explicitly approved Evaluation command.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [resultPath, executable, ...args] = process.argv.slice(2);
if (!resultPath || !executable)
  throw new Error('Result path and test executable are required.');
const result = spawnSync(executable, args, {
  stdio: 'inherit',
  timeout: 55000,
  shell: false,
});
if (result.error || result.signal)
  throw new Error(
    'Test command did not complete; no valid measurement was produced.',
  );
writeFileSync(
  resultPath,
  JSON.stringify({
    schemaVersion: 1,
    metrics: [
      {
        name: 'test_passed',
        value: result.status === 0 ? 1 : 0,
        unit: 'boolean (0 or 1)',
        samples: [result.status === 0 ? 1 : 0],
      },
    ],
    artifacts: [],
  }),
);
