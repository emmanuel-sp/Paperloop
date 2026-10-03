# Scheduling and bounded automation

Use **Sources & schedules** in a project to select sources, configure cadence, inspect handoffs and work, approve experiment rules, and activate optional model analysis. Native coding agents are the default executor. All HTTP/MCP operations call the same services.

## Cadence and durable work

Daily and weekly schedules store an IANA timezone, local hour/minute, and weekday (Sunday=0). Defaults are daily at 09:00. The service dispatches every 15 seconds while running. A missing daylight-saving wall-clock time is skipped; a repeated time occurs once. Restart and missed callbacks coalesce overdue work into one catch-up occurrence, not a backlog of every missed day. Research already analyzed against current context/content is skipped; dismissed/tested documents retain their triage. Outstanding work coalesces subsequent due ticks until it is finished or reconciled. Manual **Scan now** uses a UUID request identity; replaying that identity returns the same job.

Occurrences have a unique `(schedule ID, revision, occurrence)` constraint. Jobs persist attempts, scan/documents, ownership, progress, source retry time, and outcome. Native work stays `waiting_for_agent`; neither a browser visit nor an idle MCP connection wakes an agent. The dispatcher does not launch another coding agent.

Changing, pausing, or removing a schedule advances its revision immediately. Stale callbacks cannot acquire or complete current work. Queued old work is cancelled; in-flight analysis is interrupted and its old token is invalidated. Local API requests receive an abort signal. Already-written source material remains in the library. Paused/removed schedules create no new occurrences. Inspection of old interrupted jobs records evidence and cancels them without rerunning them.

## Native Codex and Claude Code handoffs

1. Save a native schedule with its mechanism: `codex-desktop`, `claude-desktop`, or `claude-session`.
2. Copy the returned instructions to the chosen local coding agent. The agent configures its own native scheduler. Paperloop never edits private scheduler files.
3. The agent calls `schedules_check_in` with `report: { revision, externalTaskReference, outcome: "configured" }`. If setup fails, report `outcome: "failed"` with `error`. Generated instructions show **pending**; a reported task shows **agent-reported setup**. A setup report is not observed execution.
4. On each actual invocation, call `schedules_due` with the current revision. That records `lastCheckIn`, checks pause/revision, and returns due jobs. Use `schedules_claim` with `claim: { revision, owner }`. The claim collects bounded selected-source research and returns assigned documents, context, and a token.
5. Analyze the assigned research as data. Use `schedules_heartbeat` with the token and progress before five minutes elapse. Submit `submission: { token, output: { recommendations, plans } }` through `schedules_submit`. Both arrays use the existing shared schemas; plans remain unapproved drafts. Citations must reference assigned documents and current source/context versions. The complete batch rolls back if validation fails.
6. Read `schedules_automation` before an implementation. Eligible dispatch uses `schedules_automate`; continue through the existing experiment claim/evaluation/comparison flow. Changes stay isolated for review.

Update/pause/remove generates a fresh external handoff. Paperloop enforces its local state immediately; external synchronization stays pending until the agent reports the current revision. Old native tasks may still invoke the agent until it changes/removes them, but Paperloop rejects their stale callbacks.

For local Codex tasks, keep the desktop environment and Paperloop service available. For Claude Code, select the mechanism deliberately: desktop scheduling and session-scoped `/loop` have different lifetimes. A session loop ends with its session and must be recreated later. A remote scheduler cannot assume access to this loopback service. Consult [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app), [Claude Code session scheduling](https://code.claude.com/docs/en/scheduled-tasks), and your installed desktop scheduler's available controls.

## Recovery and retries

On startup, queued jobs remain durable and running/claimed analysis becomes **interrupted**. Inspect stored recommendations, drafts, source scans, and any native execution before recording evidence with `schedules_reconcile` or the workbench inspection form. An active/current interrupted occurrence can receive a new attempt, capped at three attempts. Expired claims require the same inspection; a new agent cannot steal them. There is no silent switch from native work to a paid provider.

Source failures before API analysis use at most three attempts, exponential backoff, and the later of backoff and the recorded source cooldown. Paid provider calls are not automatically retried. Failed manual requests can be retried only by explicitly starting a distinct manual occurrence after reviewing the failure. API jobs interrupted by restart require explicit reconciliation; model generation may have incurred cost before interruption.

## Approved experiment limits

The workbench approval records enabled state, exact goals and change categories, approved evaluation plan ID, total experiment-attempt budget, and maximum evaluation runs per experiment. Bearer/MCP callers cannot approve rules or API activation. Only the authenticated workbench session can call the `/approve` operations.

Automation requires a current, non-dismissed/non-tested recommendation matching the document/project; current project context; an exact approved plan; and an enabled rule matching the submitted goal/category. One unfinished experiment/reservation per project prevents concurrent automated implementations. Dispatch is idempotent for a recommendation. Agent reasoning determines which semantic goal/category applies; these declared selections must match the approved rule.

A durable reservation consumes an experiment attempt transactionally before Git/filesystem preparation, which occurs outside the transaction. A failed or interrupted reservation remains visible and blocks further automation until inspection. `POST /api/v1/projects/:id/automation/reconcile` accepts `{ recommendationId, evidence }`; consumed attempts are retained. Startup attaches a completed workspace preparation to its retained budget, or marks uncertain preparation interrupted. Existing experiment execution/reconciliation remains in the experiment feature.

Harness and externally submitted evaluation runs consume the same transactional per-experiment budget, including failed/cancelled runs. Tightening the rule takes effect on the next run; raising a current rule never silently raises an experiment's original retained run ceiling. Disabling/changing its rule blocks further automated claims, progress, and evaluation; goal/category authorization is checked against the retained dispatch scope. Unclaimed implementations wait for a coding agent. No flow automatically merges candidates.

## Optional OpenAI/Anthropic analysis

Supply `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in the service environment. Paperloop never stores keys in project/schedule records or returns them in tool responses. A key alone starts no paid work.

In the workbench, select the provider and explicit model ID and enable analysis for this project. Select **Local paid API analysis** when creating/updating a schedule, or explicitly click its **Scan now with paid API** control. Manual and scheduled work keep that provider; failures never select another provider. Disabling activation blocks new calls and rejects unapplied output from an in-flight call.

Provider requests contain bounded research metadata/text and project objectives, constraints, context version, and summary. They omit repository paths and credentials. Limits are 25 documents per occurrence, 10,000 text characters per document, 8,000 output tokens, a two-minute request timeout, and a two-million-character response limit. The [OpenAI Responses adapter](https://developers.openai.com/api/docs/guides/structured-outputs) requests JSON output; the [Anthropic Messages adapter](https://platform.claude.com/docs/en/api/messages/create) forces the `submit_analysis` tool. Both validate the same recommendation/evaluation-draft schemas, including provenance and context. Truncated, refused, malformed, or non-successful responses apply no output. Provider error bodies and secrets are excluded from job errors.

This mode performs research analysis and evaluation drafting. Implementation waits for a coding agent; evaluation approval remains a workbench action. Model-specific compatibility errors are surfaced as job failures; select a model supporting the adapter's output mode.

## HTTP and MCP operations

| Operation | HTTP | MCP |
| --- | --- | --- |
| List schedules/jobs | `GET /api/v1/projects/:id/schedules` | `schedules_list` |
| Create / update | `POST /api/v1/projects/:id/schedules`, `PUT /api/v1/schedules/:id` | `schedules_create`, `schedules_update` |
| Pause/resume/remove | `POST /api/v1/schedules/:id/state` | `schedules_state` |
| Read handoff / report result | `GET /api/v1/schedules/:id/handoff`, `POST .../check-in` | `schedules_handoff`, `schedules_check_in` |
| Actual native callback / manual occurrence | `POST /api/v1/schedules/:id/due`, `POST .../scan-now` | `schedules_due`, `schedules_scan_now` |
| Claim / heartbeat / submit / inspect interrupted work | `POST /api/v1/schedule-jobs/:id/claim`, `/heartbeat`, `/submit`, `/reconcile` | `schedules_claim`, `schedules_heartbeat`, `schedules_submit`, `schedules_reconcile` |
| Inspect / approve rules | `GET /api/v1/projects/:id/automation`, `POST .../automation/approve` | `schedules_automation`; approval is workbench-only |
| Eligible experiment | `POST /api/v1/projects/:id/automation/dispatch` | `schedules_automate` |
| API settings / activation | `GET /api/v1/projects/:id/analysis`, `POST .../analysis/approve` | Activation is workbench-only |

Schedule configs and request bodies are defined in `packages/contracts/src/schedules.ts`. Lists return the latest 100 project jobs; source scans and extracted document content remain available through discovery/research operations. SQLite schema v6 migrates existing v5 data with a consistent backup. Tests use temporary databases, actual MCP/HTTP clients, Git workspaces, real evaluation subprocesses, and provider fixtures; no paid API calls are required.

## Explicit provider activation and spending limits

Agent & API shows provider-key availability without returning key values. Configure keys in the local service launch environment or through an OS credential manager, then restart; never paste a key into chat or repository configuration.

Before enabling a provider/model, explicitly approve one bounded connection test in the workbench. The test sends a fixed small prompt, requests at most 32 output tokens, times out after 15 seconds, bounds the response, and never retries automatically. Its request ID prevents duplicate execution. A failed or interrupted test may still be billed; startup marks unknown in-flight outcomes failed without retrying. Successful tests show provider-reported input/output tokens. Cost is unavailable without provider billing information and is not invented. Successful testing does not activate analysis.

Enabling analysis is a separate browser approval tied to the tested model. Defaults cap analysis at 1024 output tokens per call and five calls per project/provider per UTC day; failed calls count. Optional limits remain bounded. These are call/token limits, not a guaranteed dollar cap. Disabling prevents future paid starts; already-running requests may finish. Five connection tests per project per UTC day is a separate ceiling.

### Inherited schedule controls

New schedules inherit the saved workspace timezone, executor, native mechanism and provider from Settings. First use initializes the timezone from the browser; editing retains the schedule's own configuration. Cadence, local time and research intent stay visible, with timezone/execution overrides in optional details. A research angle can open a contextual schedule modal without repeating the angle. Research shows that angle's current schedule state and revision, including paused or removed intent.

Saving native intent is not scheduler installation. Controls immediately enforce each local revision and show external synchronization pending until the native client reports successful setup/update/pause/removal. Handoffs include the angle, native task reference, timing, revision, supported scheduler guidance and due/claim/heartbeat/submission protocol. They reuse existing task references and retain the complete manual handoff when a supported harness capability is unavailable. Plugin orchestration and actual native client verification remain tracked in #63; durable Track behavior remains in #50.
