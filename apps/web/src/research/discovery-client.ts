import {
  sourceCatalogSchema,
  projectSourcesSchema,
  discoveryScanSchema,
  discoveryScanListSchema,
  librarySearchResponseSchema,
  recommendationListSchema,
  recommendationSchema,
  researchDocumentSchema,
  type SourceSelection,
  type DiscoverySearchRequest,
  type TriageRecommendationRequest,
} from '@paperloop/contracts';
import { request } from '../api/client';
const project = (id: string) => `/api/v1/projects/${id}`;
const body = (method: string, value: unknown) => ({
  method,
  body: JSON.stringify(value),
});
export async function sourceCatalog() {
  return sourceCatalogSchema.parse(await request('/api/v1/research/sources'));
}
export async function projectSources(id: string) {
  return projectSourcesSchema.parse(await request(`${project(id)}/sources`));
}
export async function selectSources(id: string, value: SourceSelection) {
  return projectSourcesSchema.parse(
    await request(`${project(id)}/sources`, body('PUT', value)),
  );
}
export async function scanSources(id: string, value: DiscoverySearchRequest) {
  return discoveryScanSchema.parse(
    await request(`${project(id)}/discovery/search`, body('POST', value)),
  );
}
export async function listScans(id: string) {
  return discoveryScanListSchema.parse(
    await request(`${project(id)}/discovery/scans`),
  ).scans;
}
export async function searchLibrary(
  id: string | undefined,
  query: string,
  offset: number,
) {
  return librarySearchResponseSchema.parse(
    await request(
      `${id ? `${project(id)}/research/search` : '/api/v1/research/library'}?${new URLSearchParams({ query, offset: String(offset), limit: '20' })}`,
    ),
  );
}
export async function attachDocument(id: string, documentId: string) {
  return researchDocumentSchema.parse(
    await request(`${project(id)}/research/${documentId}/attach`, {
      method: 'POST',
    }),
  );
}
export async function getDocument(id: string, documentId: string) {
  return researchDocumentSchema.parse(
    await request(`${project(id)}/research/${documentId}`),
  );
}
export async function extractDocument(id: string, documentId: string) {
  return researchDocumentSchema.parse(
    await request(`${project(id)}/research/${documentId}/extract`, {
      method: 'POST',
    }),
  );
}
export async function fetchDocument(id: string, url: string) {
  return researchDocumentSchema.parse(
    await request(`${project(id)}/research/fetch`, body('POST', { url })),
  );
}
export async function listRecommendations(id: string, offset: number, view: 'actionable' | 'history' = 'actionable', query = '') {
  return recommendationListSchema.parse(
    await request(`${project(id)}/recommendations?${new URLSearchParams({ limit: '20', offset: String(offset), view, query })}`),
  ).recommendations;
}
export async function triageRecommendation(
  id: string,
  recommendationId: string,
  value: TriageRecommendationRequest,
) {
  return recommendationSchema.parse(
    await request(
      `${project(id)}/recommendations/${recommendationId}`,
      body('PATCH', value),
    ),
  );
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request failed.';
}
