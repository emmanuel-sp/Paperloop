# Paperloop

Paperloop is a local workbench and MCP service for applying research to software projects and measuring the result. See [product scope](PRODUCT_SCOPE.md) and [technical design](TECHNICAL_DESIGN.md).

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

Use Node.js 24 and pnpm 10.18.3. Corepack can supply the pinned pnpm version.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The workbench runs at <http://127.0.0.1:5173> and proxies `/api` to the local service at <http://127.0.0.1:3000>.

Application state is stored in SQLite under `$PAPERLOOP_DATA_DIR` when set. Otherwise Paperloop uses the platform data location (`$XDG_DATA_HOME/paperloop` or `~/.local/share/paperloop` on Linux and WSL). Startup enables foreign keys and WAL, applies committed Drizzle migrations, and writes a consistent pre-migration backup under `backups/` when upgrading an existing database. Paperloop refuses to open a database whose schema is newer than the running application.

The service binds only to `127.0.0.1` by default. `PAPERLOOP_PORT` selects the port, `PAPERLOOP_HOST` may select `127.0.0.1` or `::1`, and `PAPERLOOP_WEB_ROOT` can point to a compiled workbench directory. Startup creates an owner-only connection secret in the data directory and prints its file path, never its value. Local clients authenticate with `Authorization: Bearer <secret>`; the browser exchanges that credential at `POST /api/v1/session` for an HttpOnly, same-site session cookie. Host and Origin validation remains active even for unauthenticated health checks and static files.

Only one service process may own a data directory at a time. `SIGINT` and `SIGTERM` close the HTTP server and database before releasing that ownership. A stale lock left by a stopped process is recovered on the next startup.

Authenticated clients manage project profiles through `/api/v1/projects`. Profiles retain descriptions, objectives, constraints, and either a local directory or read-only GitHub repository reference. Repository credentials are intentionally not accepted by project contracts; integrations obtain them from separate local configuration. Every profile change, repository registration, or explicit context refresh appends a context version with its source, capture time, and Git revision when available. `GET /api/v1/projects/:id/context` returns that provenance history newest-first.

The workbench opens with the local connection exchange, then keeps project selection and the active section in the URL. It includes persistent project navigation, setup for description-only/local/GitHub projects, context provenance, and routed placeholders for Research, Evaluations, Experiments, and Sources & schedules. Project reads and mutations use the real API with visible loading, empty, validation, connection, and retry states.

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

`pnpm build` compiles contracts first, then the server and web app. CI runs these commands with a frozen lockfile.
