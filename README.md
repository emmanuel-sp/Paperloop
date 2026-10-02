# Paperloop

Paperloop is a local workbench and MCP service for applying research to software projects and measuring the result. See [product scope](PRODUCT_SCOPE.md), [technical design](TECHNICAL_DESIGN.md), the [supplied-paper experiment walkthrough](docs/EXPERIMENT_LOOP.md), and [research discovery](docs/DISCOVERY.md), and [scheduling and automation](docs/SCHEDULING.md).

## Run the local application

Install the latest Node.js 24 (at least 24.15), then follow [installation, diagnostics, and backup/recovery](docs/INSTALL.md). From a built checkout, `pnpm start` serves the workbench at http://localhost:3000; `pnpm doctor` checks the runtime. `pnpm release` creates the installable UI/server bundle.

## Repository map

```text
apps/
  web/               React workbench, routes, UI, and API client
    src/app/          App composition and routing
  server/            Fastify service and future CLI/MCP entry points
    src/              Server composition; add feature folders here
packages/
  contracts/         Shared Zod transport schemas and public types
.github/workflows/    CI checks
```

Keep server features together under `apps/server/src/<feature>/` (projects, research, evaluations, experiments, schedules). Put transport adapters beside the feature they expose, while keeping shared startup and wiring in the server root. Add `apps/web/src/<feature>/` for each workbench feature, with only reusable UI primitives in a shared `components/` directory when needed. Keep database models private to the server; `packages/contracts` contains only types and schemas that cross API or MCP boundaries. Add directories when they first contain code, so the tree stays easy to scan.

Generated `dist/`, `node_modules/`, and local application data stay out of Git. Documents and repository-wide configuration live at the root.

## Development

See [GitHub connection and repository selection](docs/GITHUB.md) for local sign-in,
private repository access, and choosing an execution checkout when needed.

Use Node.js 24.15 or newer within Node 24 and pnpm 10.18.3. Corepack can supply the pinned pnpm version.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The workbench runs at <http://127.0.0.1:5173> and proxies `/api` to the local service at <http://127.0.0.1:3000>.

Application state is stored in SQLite under `$PAPERLOOP_DATA_DIR` when set. Otherwise Paperloop uses the platform data location (`$XDG_DATA_HOME/paperloop` or `~/.local/share/paperloop` on Linux and WSL). Startup enables foreign keys and WAL, applies committed Drizzle migrations, and writes a consistent pre-migration backup under `backups/` when upgrading an existing database. Paperloop refuses to open a database whose schema is newer than the running application.

The service binds only to `127.0.0.1` by default. `PAPERLOOP_PORT` selects the port, `PAPERLOOP_HOST` may select `127.0.0.1` or `::1`, and `PAPERLOOP_WEB_ROOT` can point to a compiled workbench directory. Startup creates an owner-only connection secret in the data directory and prints its file path, never its value. It opens the built workbench with a single-use, 60-second browser handoff; the launch capability is removed from the URL and exchanged for an HttpOnly, same-site session cookie. Use `pnpm start --no-open` for manual connection. Local clients authenticate with `Authorization: Bearer <secret>`; manual browser connection exchanges that credential at `POST /api/v1/session`. Host and Origin validation remains active even for unauthenticated health checks and static files.

Only one service process may own a data directory at a time. `SIGINT` and `SIGTERM` close the HTTP server and database before releasing that ownership. A stale lock left by a stopped process is recovered on the next startup.

Authenticated clients manage project profiles through `/api/v1/projects`. Profiles retain descriptions, objectives, constraints, and either a local directory or read-only GitHub repository reference. Repository credentials are intentionally not accepted by project contracts; integrations obtain them from separate local configuration. Every profile change, repository registration, or explicit context refresh appends a context version with its source, capture time, and Git revision when available. `GET /api/v1/projects/:id/context` returns that provenance history newest-first.

The trusted local launch connects the workbench automatically, with manual connection as a fallback, then keeps project selection and the active section in the URL. New project setup asks for identity and repository, suggests editable context from bounded read-only metadata inspection without a model call, and preserves inference provenance and corrections. It includes persistent project navigation, setup for description-only/local/GitHub projects, context provenance, research discovery and triage, a reusable document library, approved evaluation plans, isolated experiments, selectable research sources, durable schedules, and explicitly activated API analysis. Project reads and mutations use the real API with visible loading, empty, validation, connection, and retry states.

Coding agents use the same project service through the authenticated Streamable
HTTP endpoint at `http://127.0.0.1:3000/mcp`. It exposes structured tools for
listing, reading, creating, and updating projects, registering repository
context, refreshing provenance, and reading context history. See
[Connect coding agents](docs/agent-connections.md) for Codex and Claude Code
setup without committing the local connection secret.

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm build` compiles contracts first, then the server and web app. CI runs these commands and Chromium workflows on Linux and macOS with a frozen lockfile, verifies the installed release bundle, and uploads the archive. Run `pnpm test:browser` after building for the browser regression suite.
