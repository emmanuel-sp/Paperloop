import { z } from 'zod';

export const githubConnectionSchema = z.object({
  login: z.string().min(1),
});

export const githubRepositoryIdentitySchema = z
  .object({
    owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}$/)
      .refine(
        (value) => value !== '.' && value !== '..',
        'Choose a repository name.',
      ),
  })
  .strict();

export const githubRepositorySchema = githubRepositoryIdentitySchema.extend({
  fullName: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(['public', 'private', 'internal']),
  access: z.literal('read'),
  defaultBranch: z.string().nullable(),
});
export type GithubRepository = z.infer<typeof githubRepositorySchema>;

export const githubRepositoryListSchema = z.object({
  repositories: z.array(githubRepositorySchema),
  hasMore: z.boolean(),
});

export const githubRepositoryQuerySchema = z
  .object({
    query: z.string().trim().max(200).default(''),
    page: z.coerce.number().int().min(1).max(20).default(1),
  })
  .strict();

export const githubRepositoryUrlRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(500),
  })
  .strict();
