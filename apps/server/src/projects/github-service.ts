import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  githubConnectionSchema,
  githubRepositoryIdentitySchema,
  githubRepositorySchema,
  type GithubRepository,
} from '@paperloop/contracts';

const execute = promisify(execFile);
export type GithubApi = (endpoint: string) => Promise<unknown>;
export class GithubAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
  }
}

// The CLI owns credentials. Never return or log subprocess errors/output: they
// can include authentication diagnostics or remote response bodies.
type GithubCommand = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<{ stdout: string }>;
export function createLocalGithubApi(
  command: GithubCommand = execute,
): GithubApi {
  return async (endpoint) => {
    let output: string;
    try {
      const result = await command(
        'gh',
        ['api', '--hostname', 'github.com', '--method', 'GET', endpoint],
        { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      );
      output = result.stdout;
    } catch (error) {
      const failure = error as { code?: string; stderr?: string };
      const diagnostic = failure.stderr ?? '';
      if (
        failure.code === 'ENOENT' ||
        /gh auth login|GH_TOKEN environment/.test(diagnostic)
      )
        throw new GithubAccessError(
          'GITHUB_DISCONNECTED',
          'Install GitHub CLI and sign in on the computer running Paperloop, then retry.',
          503,
        );
      if (/HTTP 401/.test(diagnostic))
        throw new GithubAccessError(
          'GITHUB_EXPIRED',
          'Your GitHub sign-in has expired. Sign in again on the computer running Paperloop, then retry.',
          503,
        );
      if (/HTTP 429|rate limit|secondary rate/i.test(diagnostic))
        throw new GithubAccessError(
          'GITHUB_RATE_LIMITED',
          'GitHub is limiting requests. Wait before retrying.',
          429,
        );
      if (/HTTP 403|HTTP 404/.test(diagnostic))
        throw new GithubAccessError(
          'GITHUB_ACCESS_DENIED',
          'This GitHub connection cannot read the requested repository. Check repository permissions and organization access, then retry.',
          403,
        );
      if (/HTTP 422/.test(diagnostic))
        throw new GithubAccessError(
          'INVALID_GITHUB_SEARCH',
          'GitHub could not use this search. Try a repository name or owner/repository.',
          400,
        );
      throw new GithubAccessError(
        'GITHUB_UNAVAILABLE',
        'GitHub could not be reached. Check the local connection and retry.',
      );
    }
    try {
      return JSON.parse(output) as unknown;
    } catch {
      throw new GithubAccessError(
        'GITHUB_UNAVAILABLE',
        'GitHub returned an unreadable response. Retry the connection.',
      );
    }
  };
}
export const localGithubApi = createLocalGithubApi();

const remoteRepositorySchema = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
  default_branch: z.string().nullable().optional(),
  permissions: z.object({ pull: z.boolean() }).optional(),
});

function repositoryFromApi(value: unknown): GithubRepository {
  const repo = remoteRepositorySchema.parse(value);
  if (repo.permissions?.pull === false)
    throw new GithubAccessError(
      'GITHUB_ACCESS_DENIED',
      'This GitHub connection does not have repository read access.',
      403,
    );
  return githubRepositorySchema.parse({
    owner: repo.owner.login,
    repository: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    visibility: repo.visibility ?? (repo.private ? 'private' : 'public'),
    defaultBranch: repo.default_branch ?? null,
    access: 'read',
  });
}

export function parseGithubRepositoryUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new GithubAccessError(
      'INVALID_GITHUB_URL',
      'Paste an HTTPS GitHub repository URL, such as https://github.com/owner/repository.',
      400,
    );
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match
  )
    throw new GithubAccessError(
      'INVALID_GITHUB_URL',
      'Use an HTTPS github.com repository URL without credentials, query parameters, or extra paths.',
      400,
    );
  const parsed = githubRepositoryIdentitySchema.safeParse({
    owner: match[1],
    repository: match[2]?.replace(/\.git$/, ''),
  });
  if (!parsed.success)
    throw new GithubAccessError(
      'INVALID_GITHUB_URL',
      'The URL must identify a GitHub owner and repository.',
      400,
    );
  return parsed.data;
}

export class GithubService {
  constructor(private readonly api: GithubApi = localGithubApi) {}

  async connection() {
    return githubConnectionSchema.parse(await this.api('/user'));
  }

  async list(query: string, page: number) {
    // Browse owned, collaborator and organization repositories; search also
    // includes public repositories, with private results authorized by GitHub.
    const endpoint = query
      ? `/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=30&page=${page}`
      : `/user/repos?sort=updated&affiliation=owner,collaborator,organization_member&per_page=30&page=${page}`;
    const response = await this.api(endpoint);
    const values = query
      ? z.object({ items: z.array(z.unknown()) }).parse(response).items
      : z.array(z.unknown()).parse(response);
    return {
      repositories: values.map(repositoryFromApi),
      hasMore: values.length === 30 && page < 20,
    };
  }

  async resolve(owner: string, repository: string) {
    const identity = githubRepositoryIdentitySchema.parse({
      owner,
      repository,
    });
    return repositoryFromApi(
      await this.api(`/repos/${identity.owner}/${identity.repository}`),
    );
  }

  async contextFiles(
    repository: GithubRepository,
    names: string[],
    maxBytes: number,
  ) {
    const prefix = `/repos/${repository.owner}/${repository.repository}`;
    let revision: string | null = null;
    try {
      const commit = z
        .object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) })
        .parse(
          await this.api(
            `${prefix}/commits/${encodeURIComponent(repository.defaultBranch ?? 'HEAD')}`,
          ),
        );
      revision = commit.sha;
    } catch {
      return {
        revision,
        files: [],
        uncertainty: [
          'The default-branch revision was unavailable. Only repository metadata was used; retry inspection for file context.',
        ],
      };
    }
    const pinned = revision;
    const outcomes = await Promise.all(
      names.map(async (path) => {
        try {
          const response = z
            .object({
              type: z.literal('file'),
              path: z.literal(path),
              size: z.number().nonnegative(),
              encoding: z.literal('base64'),
              content: z.string(),
            })
            .parse(
              await this.api(
                `${prefix}/contents/${encodeURIComponent(path)}?ref=${pinned}`,
              ),
            );
          if (
            response.size > maxBytes ||
            response.content.length > maxBytes * 2
          )
            return null;
          const bytes = Buffer.from(response.content, 'base64');
          if (bytes.length > maxBytes) return null;
          return { path, content: bytes.toString('utf8') };
        } catch {
          return null;
        }
      }),
    );
    const files = outcomes.filter((value) => value !== null);
    return {
      revision: pinned,
      files,
      uncertainty: [
        'Only supported root documentation and metadata were inspected. Missing, oversized, or unreadable files were skipped; private content needs read-only Contents permission.',
      ],
    };
  }
}
