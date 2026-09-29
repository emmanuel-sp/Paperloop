import { z } from 'zod';

export const healthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

const nonEmptyText = z.string().trim().min(1);

export const projectRepositorySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('local'),
    path: nonEmptyText,
  }).strict(),
  z.object({
    kind: z.literal('github'),
    owner: nonEmptyText,
    repository: nonEmptyText,
  }).strict(),
]);
export type ProjectRepository = z.infer<typeof projectRepositorySchema>;

export const createProjectRequestSchema = z.object({
  name: nonEmptyText.max(120),
  description: nonEmptyText.max(10_000),
  objectives: z.array(nonEmptyText.max(500)).max(50).default([]),
  constraints: z.array(nonEmptyText.max(500)).max(50).default([]),
  repository: projectRepositorySchema.optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = createProjectRequestSchema
  .omit({ repository: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one project field is required.',
  });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const refreshProjectContextRequestSchema = z.object({
  summary: nonEmptyText.max(20_000).optional(),
  repositoryRevision: nonEmptyText.max(200).optional(),
});
export type RefreshProjectContextRequest = z.infer<
  typeof refreshProjectContextRequestSchema
>;

export const projectContextSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  summary: z.string(),
  sourceKind: z.enum(['description', 'local', 'github']),
  sourceReference: z.string().nullable(),
  repositoryRevision: z.string().nullable(),
  capturedAt: z.iso.datetime(),
});
export type ProjectContext = z.infer<typeof projectContextSchema>;

export const projectContextListResponseSchema = z.object({
  contexts: z.array(projectContextSchema),
});
export type ProjectContextListResponse = z.infer<
  typeof projectContextListResponseSchema
>;

export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  objectives: z.array(z.string()),
  constraints: z.array(z.string()),
  repository: projectRepositorySchema.nullable(),
  currentContext: projectContextSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema),
});
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
