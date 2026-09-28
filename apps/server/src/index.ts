import { createApp } from './app.js';

const app = createApp();

try {
  const port = Number(process.env.PAPERLOOP_PORT ?? 3000);
  await app.listen({ host: '127.0.0.1', port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
