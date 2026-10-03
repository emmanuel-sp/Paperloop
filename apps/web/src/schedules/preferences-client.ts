import { useQuery } from '@tanstack/react-query';
import { workspacePreferencesSchema } from '@paperloop/contracts';
import { request } from '../api/client';
export function useWorkspacePreferences() {
  return useQuery({
    queryKey: ['workspace-preferences'],
    queryFn: async () =>
      workspacePreferencesSchema.parse(
        await request('/api/v1/preferences/initialize', {
          method: 'POST',
          body: JSON.stringify({
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          }),
        }),
      ),
  });
}
