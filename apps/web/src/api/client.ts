import {
  createProjectRequestSchema,
  ingestResearchDocumentRequestSchema,
  projectListResponseSchema,
  projectSchema,
  researchDocumentListResponseSchema,
  researchDocumentSchema,
  researchContentPageSchema,
  type CreateProjectRequest,
  type IngestResearchDocumentRequest,
  type Project,
  type ResearchDocument,
  type ResearchContentPage,
} from '@paperloop/contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      | { code?: string; message?: string }
      | undefined;
    throw new ApiError(
      payload?.message ?? `Paperloop request failed (${response.status}).`,
      response.status,
      payload?.code,
    );
  }

  if (response.status === 204) return undefined;
  return response.json();
}

export async function connectLocalSession(secret: string): Promise<void> {
  await request('/api/v1/session', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret.trim()}` },
  });
}

export async function listProjects(): Promise<Project[]> {
  const payload = await request('/api/v1/projects');
  return projectListResponseSchema.parse(payload).projects;
}

export async function getProject(projectId: string): Promise<Project> {
  return projectSchema.parse(await request(`/api/v1/projects/${projectId}`));
}

export async function createProject(
  input: CreateProjectRequest,
): Promise<Project> {
  const payload = createProjectRequestSchema.parse(input);
  return projectSchema.parse(
    await request('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );
}

export async function listResearchDocuments(
  projectId: string,
): Promise<ResearchDocument[]> {
  const payload = await request(`/api/v1/projects/${projectId}/research`);
  return researchDocumentListResponseSchema.parse(payload).documents;
}

export async function ingestResearchDocument(
  projectId: string,
  input: IngestResearchDocumentRequest,
): Promise<ResearchDocument> {
  const payload = ingestResearchDocumentRequestSchema.parse(input);
  return researchDocumentSchema.parse(
    await request(`/api/v1/projects/${projectId}/research`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );
}

export async function getResearchContent(
  projectId: string,
  documentId: string,
): Promise<ResearchContentPage> {
  return researchContentPageSchema.parse(
    await request(
      `/api/v1/projects/${projectId}/research/${documentId}/content?offset=0&limit=20000`,
    ),
  );
}
