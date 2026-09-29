import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { healthResponseSchema } from '@paperloop/contracts';
import {
  openDatabase,
  type PaperloopDatabase,
  type OpenDatabaseOptions,
} from './storage/database.js';

declare module 'fastify' {
  interface FastifyInstance {
    database: PaperloopDatabase;
  }
}

export interface CreateAppOptions {
  connectionSecret?: string;
  logger?: boolean;
  storage?: OpenDatabaseOptions;
  webRoot?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const database = openDatabase(options.storage);
  const connectionSecret =
    options.connectionSecret ?? randomBytes(32).toString('base64url');
  const browserSession = createHmac('sha256', connectionSecret)
    .update('paperloop-browser-session-v1')
    .digest('base64url');

  app.decorate('database', database);

  if (options.webRoot) {
    void app.register(fastifyStatic, {
      root: resolve(options.webRoot),
      wildcard: false,
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host;
    if (!host || !isAllowedHost(host)) {
      return reply.code(403).send({
        code: 'INVALID_HOST',
        message: 'Paperloop accepts requests only through a loopback host.',
      });
    }

    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin, host)) {
      return reply.code(403).send({
        code: 'INVALID_ORIGIN',
        message: 'The request origin does not match the local Paperloop service.',
      });
    }

    const path = request.url.split('?', 1)[0];
    const needsAuthentication =
      (path?.startsWith('/api/v1/') && path !== '/api/v1/health') ||
      path === '/mcp';
    if (!needsAuthentication) return;

    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const cookie = readCookie(request.headers.cookie, 'paperloop_session');
    const suppliedCredential =
      path === '/api/v1/session' ? bearer : bearer ?? cookie;
    const expectedCredential =
      path === '/api/v1/session' ? connectionSecret : browserSession;

    if (!credentialsMatch(suppliedCredential, expectedCredential)) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        message: 'A valid local Paperloop connection credential is required.',
      });
    }
  });

  app.addHook('onClose', async () => {
    database.close();
  });

  app.get('/api/v1/health', async () =>
    healthResponseSchema.parse({ status: 'ok' }),
  );

  app.post('/api/v1/session', async (_request, reply) => {
    reply.header(
      'set-cookie',
      `paperloop_session=${browserSession}; Path=/; HttpOnly; SameSite=Strict`,
    );
    return reply.code(204).send();
  });

  if (options.webRoot) {
    app.setNotFoundHandler(async (request, reply) => {
      const acceptsHtml = request.headers.accept?.includes('text/html');
      if (
        request.method === 'GET' &&
        acceptsHtml &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/mcp')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({
        code: 'NOT_FOUND',
        message: 'The requested Paperloop resource was not found.',
      });
    });
  }

  return app;
}

function credentialsMatch(
  supplied: string | undefined,
  expected: string,
): boolean {
  if (!supplied) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function isAllowedHost(host: string): boolean {
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string, host: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.host === host.toLowerCase();
  } catch {
    return false;
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([cookieName]) => cookieName === name)?.[1];
}
