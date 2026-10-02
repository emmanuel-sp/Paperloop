import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import {
  projectOnboardingPreviewSchema,
  type CreateProjectRequest,
  type ProjectRepository,
  type ProjectOnboardingPreview,
  type InferredProjectContext,
} from '@paperloop/contracts';
import { GithubService } from './github-service.js';
import { InvalidRepositoryError } from './project-service.js';
import { WorkflowError } from '../evaluations/plan-service.js';

const execute = promisify(execFile);
const MAX_FILE_BYTES = 32_768;
const FILES = [
  'README.md',
  'readme.md',
  'README.rst',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
];
type EvidenceFile = { path: string; content: string };

async function revision(path: string): Promise<string | null> {
  try {
    return (
      await execute('git', ['-C', path, 'rev-parse', 'HEAD'], {
        timeout: 2_000,
        maxBuffer: 4096,
      })
    ).stdout.trim();
  } catch {
    return null;
  }
}

async function localFiles(
  path: string,
  uncertainty: string[],
): Promise<EvidenceFile[]> {
  const results: EvidenceFile[] = [];
  const seenFiles = new Set<string>();
  // Fixed root filenames only. Never follow a document symlink or execute code.
  for (const name of FILES) {
    let file;
    try {
      file = await open(
        join(path, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        uncertainty.push(
          `${name} was skipped because it is not a small regular file.`,
        );
        continue;
      }
      // Case-insensitive names and hard links can identify the same document.
      const identity = `${info.dev}:${info.ino}`;
      if (seenFiles.has(identity)) continue;
      seenFiles.add(identity);
      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
      const read = await file.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead > MAX_FILE_BYTES) continue;
      results.push({
        path: name,
        content: bytes.subarray(0, read.bytesRead).toString('utf8'),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        uncertainty.push(`${name} could not be read safely.`);
    } finally {
      await file?.close();
    }
  }
  return results;
}

function sections(readme: string, heading: RegExp): string[] {
  const output: string[] = [];
  let active = false;
  let code = false;
  for (const line of readme.split('\n')) {
    if (/^\s*```|^\s*~~~/.test(line)) {
      code = !code;
      continue;
    }
    if (code) continue;
    const title = line.match(/^#{1,6}\s+(.+)/)?.[1];
    if (title) {
      active = heading.test(title);
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*+] |\d+\. )(.+)/)?.[1];
    if (active && bullet && output.length < 8)
      output.push(bullet.trim().slice(0, 500));
  }
  return output;
}

function readmeSummary(readme: string): string {
  // A short prose paragraph, excluding headings, markup and fenced code.
  const prose = readme.replace(
    /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,
    '',
  );
  return (
    prose.split(/\n\s*\n/).find((paragraph) => {
      const first = paragraph.trim();
      return first && !/^[#<![|`*-]/.test(first);
    }) ?? ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function infer(files: EvidenceFile[], metadata: string, uncertainty: string[]) {
  const readme =
    files.find((file) => /^readme\./i.test(file.path))?.content ?? '';
  let description = metadata;
  const constraints = sections(
    readme,
    /^(constraints|requirements|limitations)\b/i,
  );
  const capabilities: InferredProjectContext['evaluationCapabilities'] = [];
  const pkg = files.find((file) => file.path === 'package.json');
  if (pkg) {
    try {
      const data = JSON.parse(pkg.content) as {
        description?: unknown;
        scripts?: Record<string, unknown>;
        engines?: Record<string, unknown>;
      };
      if (typeof data.description === 'string' && data.description.trim())
        description = data.description.trim().slice(0, 1000);
      if (data.scripts && typeof data.scripts === 'object') {
        for (const [name, value] of Object.entries(data.scripts).slice(
          0,
          100,
        )) {
          if (
            /test|bench|eval/i.test(name) &&
            typeof value === 'string' &&
            capabilities.length < 8
          )
            capabilities.push({
              name: `Package script: ${name.slice(0, 100)}`,
              source: 'package.json',
            });
        }
      }
      if (data.engines && typeof data.engines.node === 'string')
        constraints.push(
          `Node.js ${data.engines.node.slice(0, 100)} (package metadata)`,
        );
    } catch {
      uncertainty.push(
        'package.json metadata was unreadable; other evidence was used.',
      );
    }
  }
  for (const file of files.filter((file) =>
    /^(pyproject|Cargo)\.toml$/.test(file.path),
  )) {
    const section =
      file.content.match(/\[(?:project|package)\]([^]*?)(?=\n\[|$)/)?.[1] ?? '';
    const value = section.match(/^description\s*=\s*["']([^"'\n]+)["']/m)?.[1];
    if (!description && value) description = value.slice(0, 1000);
    if (/\[tool\.pytest(?:\.|\])/.test(file.content))
      capabilities.push({ name: 'Pytest configuration', source: file.path });
  }
  if (!description) description = readmeSummary(readme);
  const objectives = sections(readme, /^(objectives|goals)\b/i);
  if (!files.length)
    uncertainty.push(
      'No supported metadata or documentation was readable. Add a short project summary.',
    );
  if (!objectives.length)
    uncertainty.push(
      'Objectives were not explicit in the inspected files; add them if useful.',
    );
  uncertainty.push(
    'This is a metadata suggestion, not a model analysis. Performance targets and measurements have not been inferred.',
  );
  return {
    description,
    objectives,
    constraints: constraints.slice(0, 8),
    researchDirection: (objectives[0] ?? description).slice(0, 500),
    evaluationCapabilities: capabilities,
  };
}

export class OnboardingService {
  private previews = new Map<
    string,
    { repository: string; expiresAt: number; preview: ProjectOnboardingPreview }
  >();
  constructor(private readonly github: GithubService) {}

  async preview(
    repository?: ProjectRepository,
  ): Promise<ProjectOnboardingPreview> {
    const uncertainty: string[] = [];
    let files: EvidenceFile[] = [];
    let metadata = '';
    let repositoryRevision: string | null = null;
    if (repository?.kind === 'local') {
      if (!isAbsolute(repository.path))
        throw new InvalidRepositoryError(
          'Choose an absolute local directory path.',
        );
      let path: string;
      try {
        path = await realpath(repository.path);
        if (!(await stat(path)).isDirectory()) throw new Error();
      } catch {
        throw new InvalidRepositoryError(
          'Local repository directory is unavailable. Check the path and retry.',
        );
      }
      repositoryRevision = await revision(path);
      files = await localFiles(path, uncertainty);
      const after = await revision(path);
      if (after !== repositoryRevision) {
        repositoryRevision = null;
        uncertainty.push(
          'The Git revision changed during inspection. Refresh the suggestion.',
        );
      }
      uncertainty.push(
        'Files were read from the working directory; uncommitted content may differ from the captured Git revision.',
      );
    } else if (repository?.kind === 'github') {
      const repo = await this.github.resolve(
        repository.owner,
        repository.repository,
      );
      metadata = repo.description ?? '';
      const evidence = await this.github.contextFiles(
        repo,
        FILES,
        MAX_FILE_BYTES,
      );
      files = evidence.files;
      repositoryRevision = evidence.revision;
      uncertainty.push(...evidence.uncertainty);
    } else {
      uncertainty.push(
        'No repository is selected. Describe the project in one sentence; repository context can be added later.',
      );
    }
    const suggested = infer(files, metadata, uncertainty);
    const preview = projectOnboardingPreviewSchema.parse({
      id: randomUUID(),
      description: suggested.description,
      objectives: suggested.objectives,
      constraints: suggested.constraints,
      inference: {
        method: 'repository-metadata-v1',
        capturedAt: new Date().toISOString(),
        repositoryRevision,
        files: files.map((file) => ({
          path: file.path,
          sha256: createHash('sha256').update(file.content).digest('hex'),
        })),
        uncertainty,
        researchDirection: suggested.researchDirection,
        evaluationCapabilities: suggested.evaluationCapabilities,
        correctedFields: [],
      },
    });
    const now = Date.now();
    for (const [id, value] of this.previews)
      if (value.expiresAt <= now) this.previews.delete(id);
    if (this.previews.size >= 32)
      this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.id, {
      repository: identity(repository),
      expiresAt: now + 15 * 60_000,
      preview,
    });
    return preview;
  }

  read(input: CreateProjectRequest): InferredProjectContext | undefined {
    if (!input.contextPreviewId) return undefined;
    const value = this.previews.get(input.contextPreviewId);
    if (
      !value ||
      value.expiresAt <= Date.now() ||
      value.repository !== identity(input.repository)
    )
      throw new WorkflowError(
        'CONTEXT_PREVIEW_EXPIRED',
        'The context suggestion expired or belongs to another repository. Go back and refresh it; your corrections are kept.',
        409,
      );
    const preview = value.preview;
    const correctedFields: string[] = (
      ['description', 'objectives', 'constraints'] as const
    ).filter(
      (field) =>
        JSON.stringify(input[field]) !== JSON.stringify(preview[field]),
    );
    const researchDirection =
      input.researchDirection ?? preview.inference.researchDirection;
    if (researchDirection !== preview.inference.researchDirection)
      correctedFields.push('researchDirection');
    return { ...preview.inference, researchDirection, correctedFields };
  }
}

function identity(repository?: ProjectRepository): string {
  return repository?.kind === 'local'
    ? `local:${resolve(repository.path)}`
    : repository?.kind === 'github'
      ? `github:${repository.owner.toLowerCase()}/${repository.repository.toLowerCase()}`
      : 'none';
}
