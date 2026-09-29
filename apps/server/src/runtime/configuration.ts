import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDirectory } from '../storage/database.js';

const defaultWebRoot = fileURLToPath(new URL('../../../web/dist', import.meta.url));

export interface ServerConfiguration {
  dataDirectory: string;
  host: '127.0.0.1' | '::1';
  port: number;
  webRoot?: string;
}

export interface ConfigurationEnvironment extends NodeJS.ProcessEnv {
  PAPERLOOP_DATA_DIR?: string;
  PAPERLOOP_HOST?: string;
  PAPERLOOP_PORT?: string;
  PAPERLOOP_WEB_ROOT?: string;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3000');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PAPERLOOP_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parseHost(value: string | undefined): '127.0.0.1' | '::1' {
  const host = value ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('PAPERLOOP_HOST must be 127.0.0.1 or ::1.');
  }
  return host;
}

export function loadConfiguration(
  environment: ConfigurationEnvironment = process.env,
): ServerConfiguration {
  const configuredWebRoot = environment.PAPERLOOP_WEB_ROOT?.trim();
  const webRoot = configuredWebRoot
    ? resolve(configuredWebRoot)
    : existsSync(defaultWebRoot)
      ? defaultWebRoot
      : undefined;

  if (webRoot && !statSync(webRoot).isDirectory()) {
    throw new Error('PAPERLOOP_WEB_ROOT must reference a directory.');
  }

  return {
    dataDirectory: resolveDataDirectory({ environment }),
    host: parseHost(environment.PAPERLOOP_HOST),
    port: parsePort(environment.PAPERLOOP_PORT),
    ...(webRoot ? { webRoot } : {}),
  };
}
