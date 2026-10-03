import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workspaceSettingsSchema } from '@paperloop/contracts';
import { request } from '../api/client';
export function AgentSetup({ projectId }: { projectId: string }) {
  const [agent, setAgent] = useState<'codex' | 'claude'>('codex');
  const [copied, setCopied] = useState('');
  const query = useQuery({
    queryKey: ['projects', projectId, 'settings'],
    queryFn: async () =>
      workspaceSettingsSchema.parse(
        await request(`/api/v1/projects/${projectId}/settings`),
      ),
    refetchInterval: 15000,
  });
  const endpoint = `${import.meta.env.DEV ? 'http://127.0.0.1:3000' : window.location.origin}/mcp`;
  const config =
    agent === 'codex'
      ? `[mcp_servers.paperloop]\nurl = "${endpoint}"\nbearer_token_env_var = "PAPERLOOP_CONNECTION_SECRET"`
      : JSON.stringify(
          {
            mcpServers: {
              paperloop: {
                type: 'http',
                url: endpoint,
                headers: {
                  Authorization: 'Bearer ${PAPERLOOP_CONNECTION_SECRET}',
                },
              },
            },
          },
          null,
          2,
        );
  const location =
    agent === 'codex'
      ? '~/.codex/config.toml'
      : '.mcp.json in the project opened by Claude Code';
  const credentialPath =
    query.data?.credentialPath ?? '<Paperloop credential file>';
  const shellPath =
    "'" +
    credentialPath.split("'").join(String.fromCharCode(39, 34, 39, 34, 39)) +
    "'";
  const credentialCommand =
    query.data?.platform === 'win32'
      ? `[Environment]::SetEnvironmentVariable('PAPERLOOP_CONNECTION_SECRET', (Get-Content -Raw -LiteralPath '${credentialPath.replaceAll("'", "''")}').Trim(), 'Process')`
      : `export PAPERLOOP_CONNECTION_SECRET="$(tr -d '${String.fromCharCode(92)}n' < ${shellPath})"`;
  const command =
    agent === 'codex'
      ? 'codex mcp list'
      : 'claude mcp list (or /mcp in Claude Code)';
  const prompt = `Configure Paperloop for ${agent === 'codex' ? 'Codex' : 'Claude Code'} using MCP Streamable HTTP at ${endpoint}.\nConfiguration location: ${location}.\nMerge only the paperloop entry into the existing configuration; preserve all other MCP servers and settings.\n${config}\nLocal launch-environment command (does not print the credential):\n${credentialCommand}\nRead the local connection secret from ${query.data?.credentialPath ?? 'the Paperloop startup credential file'} directly into PAPERLOOP_CONNECTION_SECRET in the environment that launches the coding agent. Do not print the secret, paste it into chat, commit it, or store its value in the configuration. Restart the agent after changing its launch environment.\nVerify with ${command}, then discover Paperloop tools, call projects_list, and read this project ${projectId}. Report failures honestly; an HTTP health response alone is not MCP verification.\nFor Windows/WSL, verify the agent can reach the same loopback endpoint. Prefer running the service and agent in the same WSL distribution; do not expose the service beyond loopback. Do not replace existing configuration or activate paid analysis.`;
  const connection = query.data?.connection;
  return (
    <section className="detail-panel research-stack agent-setup">
      <h2>Connect your coding agent</h2>
      <p>
        Paperloop coordinates research, implementation handoffs, and Evaluation.
        Your coding agent writes the candidate implementation.
      </p>
      {query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : query.isPending ? (
        <p role="status">Checking local setup…</p>
      ) : (
        <p role="status">
          {connection?.toolsListedAt
            ? `MCP tool discovery observed for reported client ${connection.client} at ${new Date(connection.toolsListedAt).toLocaleString()}.`
            : connection?.initializedAt
              ? `Client ${connection.client} initialized; tool discovery has not been observed.`
              : 'Local service reachable. No configured coding client has been verified.'}{' '}
          This does not mean an agent is working.
        </p>
      )}
      {query.data ? (
        <p className="muted">
          Provider keys:{' '}
          {query.data.providers
            .map(
              (provider) =>
                `${provider.provider}: ${provider.keyAvailable ? 'configured locally' : 'missing'}`,
            )
            .join(' · ')}
        </p>
      ) : null}
      <label>
        Coding client
        <select
          value={agent}
          onChange={(event) => setAgent(event.target.value as typeof agent)}
        >
          <option value="codex">Codex</option>
          <option value="claude">Claude Code</option>
        </select>
      </label>
      <p>
        Configuration: <code>{location}</code>
      </p>
      <p>
        Endpoint: <code>{endpoint}</code>
      </p>
      <pre className="paper-content">{config}</pre>
      <details>
        <summary>
          Load the local credential into the agent launch environment
        </summary>
        <pre className="paper-content">{credentialCommand}</pre>
      </details>
      <p>
        Local credential file:{' '}
        <code>{query.data?.credentialPath ?? 'Loading…'}</code>
      </p>
      <p className="muted">
        Load this file locally into PAPERLOOP_CONNECTION_SECRET before launching
        the agent. Keep the value out of chat, repositories, and logs. On
        Windows/WSL, the agent must reach the same loopback service; a health
        check confirms reachability only.
      </p>
      <p>
        Verify client configuration with <code>{command}</code>, then request
        Paperloop tool discovery.
      </p>
      <details>
        <summary>Complete agent setup prompt</summary>
        <pre className="paper-content">{prompt}</pre>
      </details>
      <div className="form-actions">
        <button
          className="button"
          disabled={!query.data}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(prompt);
              setCopied(
                'Setup prompt copied. It contains credential references only.',
              );
            } catch {
              setCopied('Clipboard unavailable. Copy the setup prompt above.');
            }
          }}
        >
          Copy agent setup prompt
        </button>
        <button
          className="button tertiary"
          onClick={() => void query.refetch()}
        >
          Check connection status
        </button>
      </div>
      {copied ? <p role="status">{copied}</p> : null}
    </section>
  );
}
