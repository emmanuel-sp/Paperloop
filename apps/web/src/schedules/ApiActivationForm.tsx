import { useState } from 'react';
import type { ApiActivation } from '@paperloop/contracts';
export function ApiActivationForm({
  activations,
  pending,
  onSave,
}: {
  activations: ApiActivation[];
  pending: boolean;
  onSave: (input: ApiActivation) => void;
}) {
  const initial = activations.find((value) => value.provider === 'openai');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [model, setModel] = useState(initial?.model ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  return (
    <form
      className="research-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ provider, model, enabled });
      }}
    >
      <h3>API analysis activation</h3>
      <p>
        Set keys in the service environment. Keys alone start no paid work.
        Enabling permits explicitly selected manual and scheduled analysis;
        implementation still waits for an agent.
      </p>
      {activations.map((value) => (
        <p key={value.provider}>
          {value.provider}: {value.enabled ? 'Enabled' : 'Disabled'} ·{' '}
          {value.model}
        </p>
      ))}
      <label>
        Provider
        <select
          value={provider}
          onChange={(event) => {
            const value = event.target.value as typeof provider;
            setProvider(value);
            const current = activations.find((item) => item.provider === value);
            setModel(current?.model ?? '');
            setEnabled(current?.enabled ?? false);
          }}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <label>
        Configured model
        <input
          required
          maxLength={200}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />{' '}
        Enable paid analysis for this provider and project
      </label>
      <button className="button" disabled={pending}>
        Save activation
      </button>
    </form>
  );
}
