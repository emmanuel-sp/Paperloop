import { Field } from '../components/Field';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  workspacePreferencesSchema,
  type WorkspacePreferences,
} from '@paperloop/contracts';
import { request } from '../api/client';
import { useWorkspacePreferences } from './preferences-client';
import { ScheduleWorkspace } from './ScheduleWorkspace';
import { AgentSetup } from './AgentSetup';
export function SettingsWorkspace({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams();
  const preferences = useWorkspacePreferences();
  const tab = params.get('tab') === 'preferences' ? 'preferences' : 'agent';
  return (
    <div className="research-stack">
      <div
        role="tablist"
        aria-label="Settings sections"
        className="segmented-control"
      >
        {[
          { id: 'agent', label: 'Agent & API' },
          { id: 'preferences', label: 'Preferences' },
        ].map((item) => (
          <button
            key={item.id}
            id={`settings-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const target = event.key === 'Home' ? 'agent' : event.key === 'End' ? 'preferences' : tab === 'agent' ? 'preferences' : 'agent';
              setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', target); return next; });
              document.getElementById(`settings-${target}`)?.focus();
            }}
            aria-controls={`settings-panel-${item.id}`}
            className="button tertiary"
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set('tab', item.id);
                return next;
              })
            }
          >
            {item.label}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-${tab}`}
      >
        {tab === 'agent' ? (
          <div className="research-stack">
            <AgentSetup projectId={projectId} />
            <ScheduleWorkspace projectId={projectId} view="settings" />
          </div>
        ) : preferences.data ? (
          <PreferencesForm initial={preferences.data} />
        ) : (
          <p role={preferences.error ? 'alert' : 'status'}>
            {preferences.error?.message ?? 'Loading shared preferences…'}
          </p>
        )}
      </section>
    </div>
  );
}
function PreferencesForm({ initial }: { initial: WorkspacePreferences }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      request('/api/v1/preferences', {
        method: 'PUT',
        body: JSON.stringify(workspacePreferencesSchema.parse(value)),
      }),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: ['workspace-preferences'] });
    },
  });
  return (
    <form
      className="detail-panel research-form"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <h2>Shared preferences</h2>
      <p className="muted">
        New schedules inherit these defaults across projects. Existing schedules
        retain their saved configuration.
      </p>
      <Field label="Timezone" hint="Initially detected from this browser. Use an IANA timezone such as America/Los_Angeles.">{attributes => <input {...attributes} required value={value.timezone} onChange={event => { setSaved(false); setValue({ ...value, timezone: event.target.value }); }} />}</Field>
      <label>
        Default research driver
        <select
          value={value.driver}
          onChange={(event) =>
            setValue({
              ...value,
              driver: event.target.value as WorkspacePreferences['driver'],
            })
          }
        >
          <option value="native">Your coding agent</option>
          <option value="api">Approved provider API</option>
        </select>
      </label>
      <label>
        Default native agent
        <select
          value={value.mechanism}
          onChange={(event) =>
            setValue({
              ...value,
              mechanism: event.target
                .value as WorkspacePreferences['mechanism'],
            })
          }
        >
          <option value="codex-desktop">Codex desktop</option>
          <option value="claude-desktop">Claude desktop</option>
          <option value="claude-session">Claude Code session</option>
        </select>
      </label>
      <label>
        Default provider
        <select
          value={value.provider}
          onChange={(event) =>
            setValue({
              ...value,
              provider: event.target.value as WorkspacePreferences['provider'],
            })
          }
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <p className="muted">
        Choosing a provider does not enable paid analysis or install an external
        schedule.
      </p>
      <button className="button" disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save preferences'}
      </button>
      {mutation.error ? (
        <p role="alert">{mutation.error.message}</p>
      ) : saved ? (
        <p role="status">Shared preferences saved.</p>
      ) : null}
    </form>
  );
}
