# Connect coding agents

Paperloop exposes its project profiles and versioned context at
`http://127.0.0.1:3000/mcp` using MCP Streamable HTTP. Start Paperloop, then
load its local connection secret into the shell that will launch your coding
agent:

```bash
export PAPERLOOP_CONNECTION_SECRET="$(
  tr -d '\n' < "${PAPERLOOP_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/paperloop}/connection-secret"
)"
```

The secret grants access to local project data. Keep it in the environment:
do not put it in a repository, a URL, or ordinary logs. Paperloop listens on
loopback only, so the agent must be able to reach the same host and port.

## Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.paperloop]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "PAPERLOOP_CONNECTION_SECRET"
```

Restart Codex after exporting the variable, then confirm the server is
configured with:

```bash
codex mcp list
```

Codex also supports `codex mcp add paperloop --url
http://127.0.0.1:3000/mcp`; edit the resulting configuration to add
`bearer_token_env_var`.

## Claude Code

Create `.mcp.json` in the project that should use Paperloop:

```json
{
  "mcpServers": {
    "paperloop": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer ${PAPERLOOP_CONNECTION_SECRET}"
      }
    }
  }
}
```

Claude Code expands the environment variable when it starts. Run `claude mcp
list` or use `/mcp` inside Claude Code to verify the connection.

If Paperloop runs in WSL while the agent runs on Windows, first confirm that
`http://127.0.0.1:3000/api/v1/health` is reachable from Windows. WSL's
localhost forwarding normally handles this. If it is disabled, run the agent
inside the same WSL distribution instead of exposing Paperloop beyond
loopback.

See the official [Codex MCP documentation](https://developers.openai.com/learn/docs-mcp)
and [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for
client-specific troubleshooting and additional scopes.

## Scheduling

See [Scheduling and automation](SCHEDULING.md) for native Codex/Claude handoffs, setup reports, observed check-ins, claim ownership, and bounded automation. Paperloop does not edit private agent configuration or install a native task merely by generating instructions.
