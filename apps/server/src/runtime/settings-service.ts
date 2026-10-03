import { join } from 'node:path';
import { eq, or, like } from 'drizzle-orm';
import { z } from 'zod';
import {
  workspacePreferencesSchema,
  providerProbeSchema,
  type WorkspacePreferences,
  type ProviderProbe,
  type ApiActivation,
} from '@paperloop/contracts';
import type { PaperloopDatabase } from '../storage/database.js';
import { appState } from '../storage/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import { WorkflowError } from '../evaluations/plan-service.js';
import {
  createProbeExecutor,
  type ProbeExecutor,
} from '../analysis/provider-probe.js';
export class SettingsService {
  constructor(
    private readonly database: PaperloopDatabase,
    private readonly projects: ProjectService,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly probeExecutor: ProbeExecutor = createProbeExecutor(
      environment,
    ),
  ) {
    for (const row of this.database.db.select().from(appState).where(or(like(appState.key, 'provider-probe:%'), like(appState.key, 'provider-test-request:%'))).all()) {
      if (
        !row.key.startsWith('provider-probe:') &&
        !row.key.startsWith('provider-test-request:')
      )
        continue;
      const record = JSON.parse(row.value) as ProviderProbe;
      if (record.status === 'pending')
        this.save(row.key, {
          ...record,
          status: 'failed',
          message:
            'Service restarted before a test outcome was recorded. Billing is unknown; no automatic retry.',
        });
    }
  }
  private read<T>(key: string): T | null {
    const value = this.database.db
      .select()
      .from(appState)
      .where(eq(appState.key, key))
      .get()?.value;
    return value ? (JSON.parse(value) as T) : null;
  }
  private save(key: string, value: unknown) {
    this.database.db
      .insert(appState)
      .values({ key, value: JSON.stringify(value), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value: JSON.stringify(value), updatedAt: new Date() },
      })
      .run();
  }
  preferences(): WorkspacePreferences {
    return workspacePreferencesSchema.parse(
      this.read('workspace-preferences') ?? { timezone: 'UTC' },
    );
  }
  initialize(timezone: string) {
    if (!this.read('workspace-preferences'))
      this.save(
        'workspace-preferences',
        workspacePreferencesSchema.parse({ timezone }),
      );
    return this.preferences();
  }
  update(input: WorkspacePreferences) {
    const value = workspacePreferencesSchema.parse(input);
    this.save('workspace-preferences', value);
    return value;
  }
  connection() {
    return (
      this.read<{
        client: string | null;
        initializedAt: string | null;
        toolsListedAt: string | null;
      }>('mcp-observation') ?? {
        client: null,
        initializedAt: null,
        toolsListedAt: null,
      }
    );
  }
  observeMcp(body: unknown) {
    const input = z
      .object({ method: z.string(), params: z.unknown().optional() })
      .safeParse(body);
    if (!input.success) return;
    const connection = this.connection();
    if (input.data.method === 'initialize') {
      const params = z
        .object({
          clientInfo: z.object({
            name: z.string().min(1).max(200),
            version: z.string().max(200),
          }),
        })
        .safeParse(input.data.params);
      if (params.success)
        this.save('mcp-observation', {
          client: params.data.clientInfo.name,
          initializedAt: new Date().toISOString(),
          toolsListedAt: null,
        });
    } else if (
      input.data.method === 'tools/list' &&
      connection.initializedAt &&
      Date.parse(connection.initializedAt) > Date.now() - 300000
    ) {
      this.save('mcp-observation', {
        ...connection,
        toolsListedAt: new Date().toISOString(),
      });
    }
  }
  details(projectId: string) {
    this.projects.get(projectId);
    return {
      preferences: this.preferences(),
      credentialPath: join(this.database.dataDirectory, 'connection-secret'),
      platform: process.platform,
      connection: this.connection(),
      providers: (['openai', 'anthropic'] as const).map((provider) => ({
        provider,
        keyAvailable: Boolean(
          this.environment[
            provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
          ],
        ),
        probe: this.read<ProviderProbe>(
          `provider-probe:${projectId}:${provider}`,
        ),
      })),
    };
  }
  requireTest(projectId: string, activation: ApiActivation) {
    if (!activation.enabled) return;
    const status = this.details(projectId).providers.find(
      (value) => value.provider === activation.provider,
    )!;
    if (!status.keyAvailable)
      throw new WorkflowError(
        'MODEL_KEY_MISSING',
        'Configure the provider key locally before enabling paid analysis.',
        400,
      );
    if (
      status.probe?.status !== 'succeeded' ||
      status.probe.model !== activation.model ||
      Date.parse(status.probe.createdAt) < Date.now() - 86400000
    )
      throw new WorkflowError(
        'PROVIDER_TEST_REQUIRED',
        'Approve one bounded connection test for this model before enabling analysis.',
      );
  }
  async test(
    projectId: string,
    input: {
      provider: 'openai' | 'anthropic';
      model: string;
      requestId: string;
    },
  ) {
    this.projects.get(projectId);
    const requestKey = `provider-test-request:${projectId}:${input.requestId}`;
    const existing = this.read<ProviderProbe>(requestKey);
    if (existing) {
      if (
        existing.model !== input.model ||
        existing.provider !== input.provider
      )
        throw new WorkflowError(
          'TEST_REQUEST_CHANGED',
          'Use a new approval for a different provider or model.',
        );
      return existing;
    }
    const status = this.details(projectId).providers.find(
      (value) => value.provider === input.provider,
    )!;
    if (!status.keyAvailable)
      throw new WorkflowError(
        'MODEL_KEY_MISSING',
        'Configure the provider key locally; no test was started.',
        400,
      );
    if (status.probe?.status === 'pending')
      throw new WorkflowError(
        'PROBE_ACTIVE',
        'A connection test is already pending.',
      );
    const countKey = `provider-tests:${projectId}:${new Date().toISOString().slice(0, 10)}`;
    const count = this.read<number>(countKey) ?? 0;
    if (count >= 5)
      throw new WorkflowError(
        'TEST_LIMIT',
        'Five bounded connection tests have been requested today. No more tests will be charged.',
      );
    const record: ProviderProbe = {
      ...input,
      status: 'pending',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      message:
        'One approved request, up to 32 output tokens. Cost unavailable until provider billing is inspected.',
      createdAt: new Date().toISOString(),
    };
    this.save(countKey, count + 1);
    this.save(requestKey, record);
    this.save(`provider-probe:${projectId}:${input.provider}`, record);
    const signal = AbortSignal.timeout(15000);
    let result: ProviderProbe;
    try {
      const usage = await Promise.race([
        this.probeExecutor({
          provider: input.provider,
          model: input.model,
          signal,
        }),
        new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('timeout')), {
            once: true,
          }),
        ),
      ]);
      result = providerProbeSchema.parse({
        ...record,
        ...usage,
        status: 'succeeded',
        message:
          'Connection test succeeded. Token usage is provider-reported; cost is unavailable here. Check provider billing. Analysis remains disabled until you enable it.',
      });
    } catch {
      result = {
        ...record,
        status: 'failed',
        message:
          'Connection test failed or timed out. No automatic retry; an unsuccessful request may still be billed. Check local configuration and provider billing before a new approval.',
      };
    }
    this.save(requestKey, result);
    this.save(`provider-probe:${projectId}:${input.provider}`, result);
    return result;
  }
}
