# Install Paperloop

Paperloop 0.1 runs locally on Linux, macOS, and Windows through WSL2. Install the latest Node.js 24 (at least 24.15), Git, and Python 3 on the machine or WSL distribution where it will run. Windows native execution is not supported. No paid API is needed for research supplied by you, coding-agent workflows, or local evaluations.

## Release bundle

Download `paperloop-0.1.0.tar.gz` from a passing release workflow artifact, extract it, and open a terminal in `paperloop/`:

```bash
npm ci --omit=dev
npm run doctor
npm start
```

The bundle contains the compiled server, workbench, contracts, database migrations, documentation, and a dependency lock. Install dependencies on the target OS so SQLite's native module matches that platform. If a native prebuilt module is unavailable, npm needs the platform C/C++ build tools. The bundle needs no source checkout, pnpm, or TypeScript compiler.

Open `http://localhost:3000`. Startup prints the connection-secret **file path**. Read that file and paste its value into the workbench. Do not share it or commit it to Git. Startup also reports the data directory, Node version, workbench location, and whether Git and Python are available.

From source, use Node 24 and pnpm 10.18.3: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm doctor`, then `pnpm start`. Build a bundle with `pnpm release`.

## Windows through WSL2

Keep the application, repositories, and dependencies inside the WSL filesystem. Run all install/start/evaluation commands in that same distribution. Open `http://localhost:3000` in your Windows browser. To read the credential from PowerShell, use `wsl cat /path/printed/by/startup/connection-secret`.

## Configuration and diagnostics

- `PAPERLOOP_DATA_DIR`: existing or new application data directory; default `~/.local/share/paperloop` (or `$XDG_DATA_HOME/paperloop`).
- `PAPERLOOP_PORT`: default 3000. Change it if another service is using that port.
- `PAPERLOOP_HOST`: loopback only, `127.0.0.1` or `::1`.
- `PAPERLOOP_WEB_ROOT`: override the compiled workbench location; normally inferred from the bundle.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`: optional server environment variables. They do not enable analysis on their own; choose an explicit model and enable it in **Agent & API**.

`npm run doctor` checks configuration without opening or migrating the database. A missing UI means the bundle is incomplete, or the source build has not run. If the data directory is owned by a running process, stop that instance first. Do not delete a live process's lock file. A database from a newer version requires that application version or newer.

## Backup and recovery

Stop Paperloop with Ctrl+C. From the installed bundle:

```bash
npm run backup -- /absolute/path/to/new-backup-directory
```

The command refuses an active data directory, an existing destination, or a destination inside application data. It makes a consistent SQLite snapshot and copies documents, artifacts, credentials, and experiment workspaces into an owner-only directory. Previous migration backups and process locks are excluded. Backups contain private local data; keep them private.

To restore, stop Paperloop, move the current data directory aside, and copy the backup into its **original absolute data-directory path**, preserving permissions. Start the same or a compatible newer release. Stored experiment/workspace paths and Git worktree registrations use absolute locations. Repositories outside application data must also remain at their original paths. A backup is not a migration to a different machine or repository path. Inspect interrupted runs and workspaces before recording reconciliation in the workbench.

Schema upgrades automatically create a pre-migration SQLite backup under `backups/`; those database-only files do not replace a complete application backup. Restore a complete backup for a rollback, rather than opening an upgraded database with an older release.

## Coding agents and schedules

Connect your agent to the Streamable HTTP endpoint `http://127.0.0.1:3000/mcp` with an `Authorization: Bearer` header using the local credential. See [agent connections](agent-connections.md) for Codex and Claude Code configuration, [experiment loop](EXPERIMENT_LOOP.md) for the full workflow, and [scheduling](SCHEDULING.md) for native task handoffs.

The user approves evaluation plan versions and automation/API settings in the workbench. Agents draft, analyze, and implement. A native schedule stays pending until the agent reports setup; its schedule is executed by the external agent application. The Paperloop service must be available for callbacks. API schedules run only while the local service is running.

## Release checks

CI runs build, types, lint, server/MCP/subprocess tests, and Chromium browser workflows on Linux and macOS. The Python fixture runs a complete baseline/candidate comparison without model calls. A Linux job builds and installs the release bundle, verifies startup and backup/restore, and uploads the archive. WSL is verified separately in the development workspace; it is not a native GitHub-hosted runner.
