import { WorkflowError } from '../evaluations/plan-service.js';
export type ProbeRequest = {
  provider: 'openai' | 'anthropic';
  model: string;
  signal: AbortSignal;
};
export type ProbeExecutor = (
  request: ProbeRequest,
) => Promise<{ inputTokens: number | null; outputTokens: number | null }>;
export function createProbeExecutor(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): ProbeExecutor {
  return async ({ provider, model, signal }) => {
    const key =
      environment[
        provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
      ];
    if (!key)
      throw new WorkflowError(
        'MODEL_KEY_MISSING',
        'Configure the provider key in the service environment.',
        400,
      );
    const response = await fetcher(
      provider === 'openai'
        ? 'https://api.openai.com/v1/responses'
        : 'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        redirect: 'error',
        signal,
        headers:
          provider === 'openai'
            ? {
                'content-type': 'application/json',
                authorization: `Bearer ${key}`,
              }
            : {
                'content-type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
              },
        body: JSON.stringify(
          provider === 'openai'
            ? {
                model,
                store: false,
                input: 'Reply only with OK.',
                max_output_tokens: 32,
              }
            : {
                model,
                max_tokens: 32,
                messages: [{ role: 'user', content: 'Reply only with OK.' }],
              },
        ),
      },
    );
    if (!response.ok)
      throw new WorkflowError(
        'PROBE_FAILED',
        `Provider returned HTTP ${response.status}. No automatic retry.`,
      );
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 32768) { await reader.cancel(); throw new WorkflowError('PROBE_FAILED', 'Provider response exceeded the bounded test limit.'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (body.length > 32768)
      throw new WorkflowError(
        'PROBE_FAILED',
        'Provider response exceeded the bounded test limit.',
      );
    const parsed = JSON.parse(body) as {
      status?: string;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      output?: unknown[];
      content?: unknown[];
    };
    if (
      provider === 'openai'
        ? parsed.status !== 'completed' || !parsed.output?.length
        : !parsed.stop_reason || !parsed.content?.length
    )
      throw new WorkflowError(
        'PROBE_FAILED',
        'Provider did not complete the test. No automatic retry.',
      );
    const tokens = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : null;
    return {
      inputTokens: tokens(parsed.usage?.input_tokens),
      outputTokens: tokens(parsed.usage?.output_tokens),
    };
  };
}
