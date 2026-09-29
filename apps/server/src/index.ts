import { startServer } from './runtime/server.js';

try {
  const server = await startServer();
  console.log(`Paperloop listening at ${server.address}`);
  console.log(`Connection credential: ${server.connectionSecretPath}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
