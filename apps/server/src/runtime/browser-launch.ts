import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const LAUNCH_LIFETIME_MS = 60_000;

// Only the trusted local launcher gets this capability. No HTTP route mints it.
// Keep a single pending launch in memory; restarting invalidates old links.
export class BrowserLaunch {
  private pending:
    | { token: Buffer; expiresAt: number; origin: string }
    | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  issue(address: string): string {
    const url = new URL(address);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      throw new Error('Browser launch requires the local service address.');
    }
    const token = randomBytes(32).toString('base64url');
    this.pending = {
      token: Buffer.from(token),
      expiresAt: this.now() + LAUNCH_LIFETIME_MS,
      origin: url.origin,
    };
    url.pathname = '/';
    url.search = '';
    url.hash = `launch=${token}`;
    return url.href;
  }

  consume(token: unknown, origin: string | undefined): boolean {
    const pending = this.pending;
    if (!pending) return false;
    if (this.now() >= pending.expiresAt) {
      this.clear();
      return false;
    }
    if (origin !== pending.origin || typeof token !== 'string') return false;
    const supplied = Buffer.from(token);
    if (
      supplied.length !== pending.token.length ||
      !timingSafeEqual(supplied, pending.token)
    ) {
      return false;
    }
    // Synchronous consumption prevents two simultaneous exchanges succeeding.
    this.clear();
    return true;
  }

  clear(): void {
    this.pending = undefined;
  }
}

export function browserCommand(
  url: string,
  platform = process.platform,
  wsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP),
): { executable: string; arguments: string[] } {
  if (platform === 'darwin') return { executable: 'open', arguments: [url] };
  if (platform === 'linux' && wsl) {
    // Encoded PowerShell avoids cmd.exe URL parsing and opens the Windows browser.
    const command = `Start-Process '${url.replaceAll("'", "''")}'`;
    return {
      executable: 'powershell.exe',
      arguments: [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
    };
  }
  return { executable: 'xdg-open', arguments: [url] };
}

export async function openLocalBrowser(url: string): Promise<boolean> {
  const command = browserCommand(url);
  return new Promise((resolve) => {
    // Never log child output/errors: they may contain the launch capability.
    execFile(command.executable, command.arguments, { timeout: 5_000 }, (error) => {
      resolve(!error);
    });
  });
}
