import { Field } from '../components/Field';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { request } from '../api/client';
import { workspaceSettingsSchema, providerProbeSchema } from '@paperloop/contracts';
import type { ApiActivation } from '@paperloop/contracts';
export function ApiActivationForm({
  projectId,
  onBusyChange,
  activations,
  pending,
  onSave,
}: {
  projectId: string;
  onBusyChange: (busy: boolean) => void;
  activations: ApiActivation[];
  pending: boolean;
  onSave: (input: ApiActivation) => void;
}) {
  const initial = activations.find((value) => value.provider === 'openai');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [model, setModel] = useState(initial?.model ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [maxOutputTokens, setMaxOutputTokens] = useState(initial?.maxOutputTokens ?? 1024);
  const [dailyCallLimit, setDailyCallLimit] = useState(initial?.dailyCallLimit ?? 5);
  const [consent, setConsent] = useState(false);
  const runtime = useQuery({ queryKey: ['projects', projectId, 'settings'], queryFn: async () => workspaceSettingsSchema.parse(await request(`/api/v1/projects/${projectId}/settings`)) });
  const status = runtime.data?.providers.find(value => value.provider === provider);
  const probe = useMutation({ mutationFn: async () => providerProbeSchema.parse(await request(`/api/v1/projects/${projectId}/analysis/test/approve`, { method: 'POST', body: JSON.stringify({ provider, model, consent: true, requestId: crypto.randomUUID() }) })), onSuccess: async () => { await runtime.refetch(); }, onSettled: () => setConsent(false) });
  useEffect(() => { onBusyChange(probe.isPending); return () => onBusyChange(false); }, [probe.isPending, onBusyChange]);
  const verified = status?.keyAvailable && status.probe?.status === 'succeeded' && status.probe.model === model && Date.parse(status.probe.createdAt) > Date.now() - 86400000;
  return (
    <form
      className="research-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ provider, model, enabled, maxOutputTokens, dailyCallLimit });
      }}
    >
      {activations.map((value) => (
        <p key={value.provider}>
          {value.provider}: {value.enabled ? 'Enabled' : 'Disabled'} ·{' '}
          {value.model}
        </p>
      ))}
      <label>
        Provider
        <select
          name="provider"
          autoComplete="off"
          value={provider}
          disabled={pending || probe.isPending}
          onChange={(event) => {
            const value = event.target.value as typeof provider;
            setProvider(value);
            setConsent(false);
            const current = activations.find((item) => item.provider === value);
            setModel(current?.model ?? '');
            setEnabled(current?.enabled ?? false);
            setMaxOutputTokens(current?.maxOutputTokens ?? 1024);
            setDailyCallLimit(current?.dailyCallLimit ?? 5);
          }}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <Field
        label="Model identifier"
        hint="Choose a model supported by your configured provider. This field contains no credentials."
      >
        {(attributes) => (
          <input
            name="model"
            autoComplete="off"
            {...attributes}
            required
            disabled={pending || probe.isPending}
            maxLength={200}
            value={model}
            onChange={(e) => { setConsent(false); setModel(e.target.value); }}
          />
        )}
      </Field>
      <p>{status?.keyAvailable ? 'Provider key configured locally; verification still requires a bounded test.' : `No provider key is available. Configure ${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} in the environment that starts Paperloop, then restart the service. Never paste the value here or into chat.`}</p>
      <p className="muted">Keys remain in the local service environment. Prefer your OS credential store or a protected launch environment; Paperloop does not save or display key values.</p>
      <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={pending || probe.isPending || !status?.keyAvailable} onChange={event => setConsent(event.target.checked)} /> I approve one paid connection test, up to 32 output tokens, with no automatic retry</label>
      <button type="button" className="button" disabled={pending || probe.isPending || !consent || !model.trim() || !status?.keyAvailable} onClick={() => probe.mutate()}>{probe.isPending ? 'Testing connection…' : 'Run bounded paid test'}</button>
      {status?.probe ? <section><p role="status">{status.probe.message}</p><p>Input tokens: {status.probe.inputTokens ?? 'Unavailable'} · Output tokens: {status.probe.outputTokens ?? 'Unavailable'} · Cost: {status.probe.costUsd === null ? 'Unavailable; check provider billing' : `$${status.probe.costUsd}`}</p></section> : null}
      {probe.error || runtime.error ? <p role="alert">{(probe.error ?? runtime.error)?.message}</p> : null}
      <p className="muted">Analysis limits: {maxOutputTokens} output tokens per call and {dailyCallLimit} calls per UTC day.</p>
      <details><summary>Spending limits</summary><label>Maximum output tokens per analysis<input type="number" required min={32} max={8000} value={maxOutputTokens} onChange={event => setMaxOutputTokens(Number(event.target.value))} /></label><label>Daily analysis call limit<input type="number" required min={1} max={100} value={dailyCallLimit} onChange={event => setDailyCallLimit(Number(event.target.value))} /></label><p className="muted">Limits apply per project/provider and UTC day; failed calls count. Token/call limits are not a guaranteed dollar cap. Provider billing remains the cost source of truth.</p></details>
      <label className="checkbox-label">
        <input
          name="paidAnalysisEnabled"
          autoComplete="off"
          type="checkbox"
          checked={enabled}
          disabled={!verified && !enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />{' '}
        Enable paid analysis for this provider and project
      </label>
      <p className="muted">Disabling prevents new paid requests; a request already in progress may finish.</p>
      <button className="button" disabled={pending || probe.isPending || (enabled && !verified)}>
        Save API settings
      </button>
    </form>
  );
}
