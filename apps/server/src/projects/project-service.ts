import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type CreateProjectRequest,
  type Project,
  type ProjectContext,
  type ProjectRepository,
  type RefreshProjectContextRequest,
  type UpdateProjectRequest,
} from '@paperloop/contracts';
import { desc, eq } from 'drizzle-orm';
import type { PaperloopDatabase } from '../storage/database.js';
import {
  projectContextSnapshots,
  projectRepositories,
  projects,
} from '../storage/schema.js';

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project ${projectId} was not found.`);
    this.name = 'ProjectNotFoundError';
  }
}

export class InvalidRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidRepositoryError';
  }
}

interface RepositoryContext {
  repository: ProjectRepository;
  repositoryRevision: string | null;
  sourceKind: 'local' | 'github';
  sourceReference: string;
}

export class ProjectService {
  constructor(private readonly database: PaperloopDatabase) {}

  create(input: CreateProjectRequest): Project {
    const now = new Date();
    const projectId = randomUUID();
    const repositoryContext = input.repository
      ? this.prepareRepository(input.repository)
      : undefined;

    this.database.db.transaction((transaction) => {
      transaction
        .insert(projects)
        .values({
          id: projectId,
          name: input.name,
          description: input.description,
          objectives: input.objectives,
          constraints: input.constraints,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      if (repositoryContext) {
        transaction
          .insert(projectRepositories)
          .values(repositoryValues(projectId, repositoryContext.repository, now))
          .run();
      }

      transaction
        .insert(projectContextSnapshots)
        .values({
          id: randomUUID(),
          projectId,
          version: 1,
          summary: input.description,
          sourceKind: repositoryContext?.sourceKind ?? 'description',
          sourceReference: repositoryContext?.sourceReference ?? null,
          repositoryRevision: repositoryContext?.repositoryRevision ?? null,
          capturedAt: now,
        })
        .run();
    });

    return this.get(projectId);
  }

  list(): Project[] {
    return this.database.db
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .all()
      .map((project) => this.hydrate(project));
  }

  get(projectId: string): Project {
    const project = this.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!project) throw new ProjectNotFoundError(projectId);
    return this.hydrate(project);
  }

  listContext(projectId: string): ProjectContext[] {
    this.get(projectId);
    return this.database.db
      .select()
      .from(projectContextSnapshots)
      .where(eq(projectContextSnapshots.projectId, projectId))
      .orderBy(desc(projectContextSnapshots.version))
      .all()
      .map(contextFromRow);
  }

  update(projectId: string, input: UpdateProjectRequest): Project {
    const current = this.get(projectId);
    const now = new Date();

    this.database.db.transaction((transaction) => {
      transaction
        .update(projects)
        .set({ ...input, updatedAt: now })
        .where(eq(projects.id, projectId))
        .run();

      transaction
        .insert(projectContextSnapshots)
        .values({
          id: randomUUID(),
          projectId,
          version: current.currentContext.version + 1,
          summary: input.description ?? current.description,
          sourceKind: current.currentContext.sourceKind,
          sourceReference: current.currentContext.sourceReference,
          repositoryRevision: current.currentContext.repositoryRevision,
          capturedAt: now,
        })
        .run();
    });

    return this.get(projectId);
  }

  refreshContext(
    projectId: string,
    input: RefreshProjectContextRequest,
  ): Project {
    const current = this.get(projectId);
    const now = new Date();
    const repositoryContext = current.repository
      ? this.prepareRepository(current.repository)
      : undefined;
    const revision =
      repositoryContext?.sourceKind === 'github'
        ? input.repositoryRevision ?? null
        : repositoryContext?.repositoryRevision ?? null;

    this.database.db.transaction((transaction) => {
      transaction
        .insert(projectContextSnapshots)
        .values({
          id: randomUUID(),
          projectId,
          version: current.currentContext.version + 1,
          summary: input.summary ?? current.description,
          sourceKind: repositoryContext?.sourceKind ?? 'description',
          sourceReference: repositoryContext?.sourceReference ?? null,
          repositoryRevision: revision,
          capturedAt: now,
        })
        .run();
      transaction
        .update(projects)
        .set({ updatedAt: now })
        .where(eq(projects.id, projectId))
        .run();
    });

    return this.get(projectId);
  }

  registerRepository(
    projectId: string,
    repository: ProjectRepository,
  ): Project {
    const current = this.get(projectId);
    const repositoryContext = this.prepareRepository(repository);
    const now = new Date();

    this.database.db.transaction((transaction) => {
      transaction
        .insert(projectRepositories)
        .values(repositoryValues(projectId, repositoryContext.repository, now))
        .onConflictDoUpdate({
          target: projectRepositories.projectId,
          set: {
            kind: repositoryContext.repository.kind,
            localPath:
              repositoryContext.repository.kind === 'local'
                ? repositoryContext.repository.path
                : null,
            githubOwner:
              repositoryContext.repository.kind === 'github'
                ? repositoryContext.repository.owner
                : null,
            githubRepository:
              repositoryContext.repository.kind === 'github'
                ? repositoryContext.repository.repository
                : null,
            updatedAt: now,
          },
        })
        .run();
      transaction
        .insert(projectContextSnapshots)
        .values({
          id: randomUUID(),
          projectId,
          version: current.currentContext.version + 1,
          summary: current.description,
          sourceKind: repositoryContext.sourceKind,
          sourceReference: repositoryContext.sourceReference,
          repositoryRevision: repositoryContext.repositoryRevision,
          capturedAt: now,
        })
        .run();
      transaction
        .update(projects)
        .set({ updatedAt: now })
        .where(eq(projects.id, projectId))
        .run();
    });

    return this.get(projectId);
  }

  private prepareRepository(repository: ProjectRepository): RepositoryContext {
    if (repository.kind === 'github') {
      return {
        repository,
        repositoryRevision: null,
        sourceKind: 'github',
        sourceReference: `https://github.com/${repository.owner}/${repository.repository}`,
      };
    }

    const path = resolve(repository.path);
    try {
      if (!statSync(path).isDirectory()) {
        throw new InvalidRepositoryError(
          `Local repository path is not a directory: ${path}`,
        );
      }
    } catch (error) {
      if (error instanceof InvalidRepositoryError) throw error;
      throw new InvalidRepositoryError(
        `Local repository path is unavailable: ${path}`,
        { cause: error },
      );
    }

    return {
      repository: { kind: 'local', path },
      repositoryRevision: readGitRevision(path),
      sourceKind: 'local',
      sourceReference: path,
    };
  }

  private hydrate(project: typeof projects.$inferSelect): Project {
    const repositoryRow = this.database.db
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, project.id))
      .get();
    const context = this.database.db
      .select()
      .from(projectContextSnapshots)
      .where(eq(projectContextSnapshots.projectId, project.id))
      .orderBy(desc(projectContextSnapshots.version))
      .get();

    if (!context) {
      throw new Error(`Project ${project.id} has no context snapshot.`);
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      objectives: project.objectives,
      constraints: project.constraints,
      repository: repositoryRow ? repositoryFromRow(repositoryRow) : null,
      currentContext: contextFromRow(context),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

function repositoryValues(
  projectId: string,
  repository: ProjectRepository,
  now: Date,
): typeof projectRepositories.$inferInsert {
  return {
    id: randomUUID(),
    projectId,
    kind: repository.kind,
    localPath: repository.kind === 'local' ? repository.path : null,
    githubOwner: repository.kind === 'github' ? repository.owner : null,
    githubRepository:
      repository.kind === 'github' ? repository.repository : null,
    createdAt: now,
    updatedAt: now,
  };
}

function repositoryFromRow(
  row: typeof projectRepositories.$inferSelect,
): ProjectRepository {
  if (row.kind === 'local' && row.localPath) {
    return { kind: 'local', path: row.localPath };
  }
  if (row.kind === 'github' && row.githubOwner && row.githubRepository) {
    return {
      kind: 'github',
      owner: row.githubOwner,
      repository: row.githubRepository,
    };
  }
  throw new Error(`Repository record ${row.id} is inconsistent.`);
}

function contextFromRow(
  row: typeof projectContextSnapshots.$inferSelect,
): ProjectContext {
  return {
    id: row.id,
    version: row.version,
    summary: row.summary,
    sourceKind: row.sourceKind,
    sourceReference: row.sourceReference,
    repositoryRevision: row.repositoryRevision,
    capturedAt: row.capturedAt.toISOString(),
  };
}

function readGitRevision(path: string): string | null {
  try {
    return execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
