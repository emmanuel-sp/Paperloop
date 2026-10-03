import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  scheduleConfigSchema,
  type ScheduleConfig,
} from '@paperloop/contracts';
export function ScheduleEditor({
  initial,
  projectId,
  editing,
  pending,
  onSave,
  onCancel,
}: {
  initial?: ScheduleConfig;
  projectId: string;
  editing: boolean;
  pending: boolean;
  onSave: (config: ScheduleConfig) => void;
  onCancel: () => void;
}) {
  const [config, setConfig] = useState(
    () =>
      initial ??
      scheduleConfigSchema.parse({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
  );
  function save(event: FormEvent) {
    event.preventDefault();
    onSave(config);
  }
  return (
    <form className="research-form" onSubmit={save}>
      <h3>{editing ? 'Update schedule' : 'New schedule'}</h3>
      <label>
        Cadence
        <select
          disabled={pending}
          name="cadence"
          autoComplete="off"
          value={config.cadence}
          onChange={(e) =>
            setConfig({
              ...config,
              cadence: e.target.value as ScheduleConfig['cadence'],
            })
          }
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label>
        Local time
        <input
          disabled={pending}
          name="local-time"
          autoComplete="off"
          type="time"
          required
          value={`${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')}`}
          onChange={(e) => {
            const [hour, minute] = e.target.value.split(':').map(Number);
            setConfig({ ...config, hour: hour ?? 9, minute: minute ?? 0 });
          }}
        />
      </label>
      {config.cadence === 'weekly' ? (
        <label>
          Weekday
          <select
            disabled={pending}
            name="weekday"
            autoComplete="off"
            value={config.weekday}
            onChange={(e) =>
              setConfig({ ...config, weekday: Number(e.target.value) })
            }
          >
            {[
              'Sunday',
              'Monday',
              'Tuesday',
              'Wednesday',
              'Thursday',
              'Friday',
              'Saturday',
            ].map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Research query
        <input
          disabled={pending}
          name="research-query"
          autoComplete="off"
          value={config.query}
          maxLength={500}
          onChange={(e) => setConfig({ ...config, query: e.target.value })}
        />
      </label>
      <p className="workflow-notice">
        {editing ? 'Saved schedule settings' : 'Defaults from Settings'}:{' '}
        {config.timezone} ·{' '}
        {config.driver === 'native'
          ? config.mechanism
          : `${config.provider} paid API`}
        . Native setup remains pending until your agent reports it. API work
        requires separate activation.
      </p>
      <Link to={`/projects/${projectId}/settings?tab=preferences`}>
        Review shared preferences
      </Link>
      <details>
        <summary>Override timezone or execution defaults</summary>
        <label>
          Timezone
          <input
            disabled={pending}
            name="timezone"
            autoComplete="off"
            required
            value={config.timezone}
            onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
          />
        </label>
        <label>
          Executor
          <select
            disabled={pending}
            name="executor"
            autoComplete="off"
            value={config.driver}
            onChange={(e) =>
              setConfig({
                ...config,
                driver: e.target.value as ScheduleConfig['driver'],
              })
            }
          >
            <option value="native">Native coding agent</option>
            <option value="api">Local paid API analysis</option>
          </select>
        </label>
        {config.driver === 'native' ? (
          <label>
            Native mechanism
            <select
              disabled={pending}
              name="native-mechanism"
              autoComplete="off"
              value={config.mechanism}
              onChange={(e) =>
                setConfig({
                  ...config,
                  mechanism: e.target.value as ScheduleConfig['mechanism'],
                })
              }
            >
              <option value="codex-desktop">Codex desktop</option>
              <option value="claude-desktop">Claude Code desktop</option>
              <option value="claude-session">Claude Code session /loop</option>
            </select>
          </label>
        ) : (
          <label>
            API provider
            <select
              disabled={pending}
              name="api-provider"
              autoComplete="off"
              value={config.provider}
              onChange={(e) =>
                setConfig({
                  ...config,
                  provider: e.target.value as ScheduleConfig['provider'],
                })
              }
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
        )}
      </details>
      <button className="button primary" disabled={pending}>
        Save schedule
      </button>
      {editing ? (
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel edit
        </button>
      ) : null}
    </form>
  );
}
