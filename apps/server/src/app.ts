import { ScheduleService } from './schedules/schedule-service.js';
import { registerScheduleRoutes } from './schedules/schedule-routes.js';
import { AnalysisService } from './analysis/analysis-service.js';
import type { ModelExecutor } from './analysis/providers.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { healthResponseSchema } from '@paperloop/contracts';
import { ZodError } from 'zod';
import type { BrowserLaunch } from './runtime/browser-launch.js';
import { PlanService, WorkflowError } from './evaluations/plan-service.js';
import { ExperimentService } from './experiments/experiment-service.js';
import { registerWorkflowRoutes } from './experiments/workflow-routes.js';
import { registerProjectMcp } from './mcp/project-mcp.js';
import { registerProjectRoutes } from './projects/project-routes.js';
import { registerGithubRoutes } from './projects/github-routes.js';
import {
  GithubAccessError,
  GithubService,
  type GithubApi,
} from './projects/github-service.js';
import {
  InvalidRepositoryError,
  ProjectNotFoundError,
  ProjectService,
} from './projects/project-service.js';
import { DiscoveryService } from './research/discovery-service.js';
import { registerDiscoveryRoutes } from './research/discovery-routes.js';
import {
  SourceFetchError,
  type PublicFetcher,
} from './research/public-fetch.js';
import { ResearchImportService } from './research/import-service.js';
import { registerResearchRoutes } from './research/research-routes.js';
import {
  ResearchDocumentNotFoundError,
  ResearchService,
} from './research/research-service.js';
import {
  openDatabase,
  type PaperloopDatabase,
  type OpenDatabaseOptions,
} from './storage/database.js';

declare module 'fastify' {
  interface FastifyInstance {
    database: PaperloopDatabase;
    projects: ProjectService;
    research: ResearchService;
    discovery: DiscoveryService;
    plans: PlanService;
    experiments: ExperimentService;
    schedules: ScheduleService;
    analysis: AnalysisService;
  }
}

export interface CreateAppOptions {
  browserLaunch?: BrowserLaunch;
  githubApi?: GithubApi;
  connectionSecret?: string;
  researchFetcher?: PublicFetcher;
  logger?: boolean;
  modelExecutor?: ModelExecutor;
  scheduleNow?: () => Date;
  dispatcher?: boolean;
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
  const browserLaunch = options.browserLaunch;

  app.decorate('database', database);
  const projectService = new ProjectService(database);
  app.decorate('projects', projectService);
  const researchService = new ResearchService(database, projectService);
  app.decorate('research', researchService);
  const discovery = new DiscoveryService(
    database,
    projectService,
    researchService,
    options.researchFetcher,
  );
  app.decorate('discovery', discovery);
  const plans = new PlanService(database, projectService);
  const experiments = new ExperimentService(
    database,
    projectService,
    researchService,
    plans,
  );
  app.decorate('plans', plans);
  app.decorate('experiments', experiments);
  const analysis = new AnalysisService(
    database,
    projectService,
    researchService,
    discovery,
    plans,
    options.modelExecutor,
  );
  const schedules = new ScheduleService(
    database,
    projectService,
    discovery,
    plans,
    experiments,
    analysis,
    options.scheduleNow,
  );
  app.decorate('analysis', analysis);
  app.decorate('schedules', schedules);
  app.addHook('onReady', async () => {
    if (options.dispatcher !== false) schedules.start();
  });

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
        message:
          'The request origin does not match the local Paperloop service.',
      });
    }

    const path = request.url.split('?', 1)[0];
    if (path === '/api/v1/session/launch') {
      reply.header('cache-control', 'no-store');
      if (!origin) {
        return reply.code(403).send({
          code: 'INVALID_ORIGIN',
          message: 'Open Paperloop from its trusted local launcher.',
        });
      }
      return;
    }
    const needsAuthentication =
      (path?.startsWith('/api/v1/') && path !== '/api/v1/health') ||
      path === '/mcp';
    if (!needsAuthentication) return;

    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const cookie = readCookie(request.headers.cookie, 'paperloop_session');
    if (
      path?.endsWith('/approve') &&
      !credentialsMatch(cookie, browserSession)
    ) {
      return reply.code(403).send({
        code: 'UI_APPROVAL_REQUIRED',
        message: 'Approve this plan in the connected workbench.',
      });
    }
    const authenticated =
      path === '/api/v1/session'
        ? credentialsMatch(bearer, connectionSecret)
        : credentialsMatch(bearer, connectionSecret) ||
          credentialsMatch(cookie, browserSession);

    if (!authenticated) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        message: 'A valid local Paperloop connection credential is required.',
      });
    }
  });

  app.addHook('onClose', async () => {
    browserLaunch?.clear();
    await schedules.close();
    await experiments.close();
    database.close();
  });

  app.get('/api/v1/health', async () =>
    healthResponseSchema.parse({ status: 'ok' }),
  );

  app.post('/api/v1/session', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header(
      'set-cookie',
      `paperloop_session=${browserSession}; Path=/; HttpOnly; SameSite=Strict`,
    );
    return reply.code(204).send();
  });

  app.post('/api/v1/session/launch', async (request, reply) => {
    const token = (request.body as { token?: unknown } | null)?.token;
    if (!browserLaunch?.consume(token, request.headers.origin)) {
      return reply.code(401).send({
        code: 'LAUNCH_EXPIRED',
        message:
          'This launch link is expired or already used. Restart Paperloop to open a new link, or connect manually.',
      });
    }
    reply.header(
      'set-cookie',
      `paperloop_session=${browserSession}; Path=/; HttpOnly; SameSite=Strict`,
    );
    return reply.code(204).send();
  });

  const github = new GithubService(options.githubApi);
  registerGithubRoutes(app, github);
  registerProjectRoutes(app, projectService, github);
  registerResearchRoutes(app, researchService, new ResearchImportService(projectService, researchService, options.researchFetcher));
  registerDiscoveryRoutes(app, discovery, researchService);
  registerWorkflowRoutes(app, plans, experiments);
  registerScheduleRoutes(app, schedules, analysis);
  registerProjectMcp(
    app,
    projectService,
    researchService,
    plans,
    experiments,
    discovery,
    schedules,
  );

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof GithubAccessError)
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
    if (error instanceof SourceFetchError)
      return reply
        .code(400)
        .send({ code: 'INVALID_SOURCE_URL', message: error.message });
    if (error instanceof WorkflowError)
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'The request did not match the expected contract.',
        details: error.issues,
      });
    }
    if (error instanceof ProjectNotFoundError) {
      return reply.code(404).send({
        code: 'PROJECT_NOT_FOUND',
        message: error.message,
      });
    }
    if (error instanceof InvalidRepositoryError) {
      return reply.code(400).send({
        code: 'INVALID_REPOSITORY',
        message: error.message,
      });
    }
    if (error instanceof ResearchDocumentNotFoundError) {
      return reply.code(404).send({
        code: 'RESEARCH_DOCUMENT_NOT_FOUND',
        message: error.message,
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Paperloop could not complete the request.',
    });
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
    return (
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '[::1]'
    );
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

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  return header
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([cookieName]) => cookieName === name)?.[1];
}
