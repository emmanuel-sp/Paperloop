import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function processGroupStopped(
  snapshot: string,
  groupId: number,
): boolean {
  const rows = snapshot
    .trim()
    .split('\n')
    .filter((row) => row.trim());
  return rows.every((row) => {
    const match = /^\s*(\d+)\s+([A-Za-z<>+-]+)\s*$/.exec(row);
    // Unknown output cannot establish that cancellation succeeded.
    if (!match) return false;
    return Number(match[1]) !== groupId || /^[ZX]/.test(match[2]!);
  });
}

async function readProcessSnapshot(): Promise<string> {
  const { stdout } = await execute('ps', ['-e', '-o', 'pgid=,stat='], {
    encoding: 'utf8',
    timeout: 500,
    maxBuffer: 2_000_000,
  });
  return stdout;
}

export async function confirmProcessGroupStopped(
  groupId: number,
  inspect: () => Promise<string> = readProcessSnapshot,
): Promise<boolean> {
  const deadline = Date.now() + 2000;
  do {
    try {
      const stdout = await inspect();
      // Unix init may retain zombies, but they can no longer execute or write.
      if (processGroupStopped(stdout, groupId)) return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  return false;
}
