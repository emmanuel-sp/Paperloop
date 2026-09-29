import { createApp } from '../app.js';
import { loadConfiguration, type ServerConfiguration } from './configuration.js';
import { loadOrCreateConnectionSecret } from './connection-secret.js';
import { acquireInstanceLock } from './instance-lock.js';

export interface StartServerOptions {
  configuration?: ServerConfiguration;
  installSignalHandlers?: boolean;
}

export interface RunningServer {
  address: string;
  close(): Promise<void>;
  connectionSecretPath: string;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const configuration = options.configuration ?? loadConfiguration();
  const instanceLock = acquireInstanceLock(configuration.dataDirectory);

  try {
    const connectionSecret = loadOrCreateConnectionSecret(
      configuration.dataDirectory,
    );
    const app = createApp({
      connectionSecret: connectionSecret.value,
      storage: { dataDirectory: configuration.dataDirectory },
      ...(configuration.webRoot ? { webRoot: configuration.webRoot } : {}),
    });
    let closed = false;

    const close = async () => {
      if (closed) return;
      closed = true;
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      try {
        await app.close();
      } finally {
        instanceLock.release();
      }
    };

    const handleSignal = () => {
      void close().catch((error: unknown) => app.log.error(error));
    };

    if (options.installSignalHandlers !== false) {
      process.once('SIGINT', handleSignal);
      process.once('SIGTERM', handleSignal);
    }

    try {
      const address = await app.listen({
        host: configuration.host,
        port: configuration.port,
      });
      return {
        address,
        close,
        connectionSecretPath: connectionSecret.filePath,
      };
    } catch (error) {
      await close();
      throw error;
    }
  } catch (error) {
    instanceLock.release();
    throw error;
  }
}
