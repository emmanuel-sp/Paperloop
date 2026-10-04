# Developing Paperloop with unattended agents

This is the operating plan for completing milestone 6, then using Paperloop to improve Paperloop. It records the owner's October 1, 2026 instructions so new task threads can resume without depending on a long chat.

Current execution mode: the owner manually starts remote development tasks from mobile. No automatic development schedule has been registered. The scheduling guidance below is retained for a future switch; it does not restrict manually requested work to particular weekdays.

## Authorization and boundaries

The owner authorizes implementing existing issues, fixing defects, reviewing the application visually, creating branches and PRs, and merging verified changes. Improve usability within approved issue scope. Ask the owner before expanding functional scope, adding paid execution, or starting a proposed new milestone. Preserve Paperloop's exact evaluation approval and authentication boundaries; permission to develop and merge the repository does not approve application evaluation commands or model spending.

Use GPT-6.1 Sol with medium reasoning by default, when available in the task runner. Use higher reasoning for difficult diagnosis, authentication, subprocess execution, or evaluation approval changes when warranted. A prompt alone does not select the actual model: configure the runner accordingly. Do not silently substitute another provider or buy API capacity. Use one worker at a time; no parallel implementation agents by default.

## Execution prerequisite

The cloud checkout is prepared, but an environment is not a scheduler. This plan does not itself create a scheduled task or a persistent cloud worker.

- This onboarding chat has no exposed tool for creating or updating Codex scheduled tasks. The owner reports that their UI allows deselecting **Run on this computer** and starting a **new task**. Use that remote/new-task option, with this cloud environment, and verify the resulting run before considering the executor proven.
- Paperloop persists research jobs and produces native-agent scheduling handoffs. Its dispatcher does not launch a coding agent. An idle MCP connection cannot wake one.
- The current public scheduling documentation distinguishes desktop project tasks, which require the machine/app to remain available, from web tasks with connected tools. A generic web schedule does not prove access to a coding checkout.
- To meet the owner’s PC-off requirement, verify that the selected scheduling interface launches actual coding runs in this cloud environment. Test a scheduled run while the PC is off: verify its timestamp, Git access, checkout, build/test capability, model, and durable PR/checkpoint output. Do not label it active based only on a saved prompt or setup report.
- A hosted API runner is an alternative to investigate if the native cloud route is unavailable. It needs separately approved billing and credentials; do not copy interactive login credentials into GitHub Actions or repository secrets.

References: [Codex scheduling documentation](https://developers.openai.com/codex/app/automations/) and [Paperloop handoffs](SCHEDULING.md).

## Scheduling and retry bounds

The owner manually starts development runs. No account-usage reserve, telemetry preflight or reset-date scheduling gate applies. Do not repeat historical account-usage observations in task results or use them to delay authorized work.

A future recurring schedule must be configured and verified separately with the owner. This document does not register one. Keep one substantial work unit per run and one worker at a time. Do not start continuous polling, parallel schedules per issue, unlimited retries or catch-up bursts. Prefer supported completion/CI events and bounded status checks. If a real rate-limit error prevents work, persist a checkpoint with the actual error and resume when access is available. Do not retry paid calls automatically.

## Work queue and thread boundaries

GitHub issues contain acceptance criteria; GitHub Project #2 contains status. Re-read both before starting. Dependencies override numeric order. Close issues only when acceptance criteria are met by merged changes and supporting evidence, not merely when a PR exists.

| Order | Issues | Context and grouping |
| --- | --- | --- |
| 0 | #35 / #36, PR #48 | Existing combined foundations work. Review the diff and populated screenshots against issue criteria and the owner's latest notes. Linux/macOS CI passed on `b012424`; this is not a substitute for review. One visual criterion in #36 remained unchecked. Fix or explicitly resolve it before closing. |
| 1 | #38, then #37 | Repository connection precedes inferred onboarding. Separate implementation threads for the authentication integration and trusted browser-session handoff. Carry a short shared design handoff between them. |
| 2 | #39, then #40 | Research feed and broad import share the same product context. Establish the Research flow first; use a separate bounded import phase when needed. Retrieval/extraction and unavailable-source behavior need their own verification. |
| 3 | #41 | Dedicated evaluation context: inference, exact command approval, fingerprints, and truthful no-key states. Do not combine this approval-sensitive work with a broad UI cleanup. |
| 4 | #42 / #47 | Group the experiment workspace and comparison presentation when cohesive. Split into successive PRs if one run cannot complete both. Preserve distinct criteria for progress, provenance, metrics, and inconclusive evidence. |
| 5 | #44, then #43 | Settings preferences and schedule inheritance are one coherent area. Treat paid activation/MCP setup as a separate reviewed phase, then schedule UX. No paid tests without authorization. |
| 5a | #50 | Persistent **Track** angles, schedule integration, feed triage, and automatic draft Evaluation after #39/#41/#43/#44. Dedicated cross-feature integration phase before the full demo. |
| 6 | #45 | Overview after onboarding, Research, and Experiments have stable context and next actions. Dedicated populated-state design pass. |
| 7 | #46, then #34 | Repeatable isolated ML demo, full journey, populated desktop/mobile visual inspection, failure and no-key states. Complete the roadmap only after every included issue is verified. |

Later owner amendments in #34 override the original table where dependencies changed: publish #46’s reusable scenario foundation early, design #66 before changing Evaluation contracts, coordinate its evidence with #47, and implement #63 with the remaining #44/#43 amendments before #50. Final #46 verification remains last. See [isolated scenarios](SCENARIOS.md) for the early fixture loader.

Only one implementation PR should be active under this worker at a time. Existing user work or another worker's PR takes priority over starting a competing change. Fresh threads should read the selected issue, directly required dependencies, the relevant design document, and the previous checkpoint; do not import the whole historical conversation on every run.

## Owner's design notes

These notes refine milestone 6. Keep them visible during acceptance review rather than treating foundations PR #48 as final design approval.

These requirements are also in GitHub: #36 owns application typography/transitions/progress, #39 owns the unified recommendation feed and triage, #41 owns automatic Evaluation suggestion, #43 owns inherited schedule integration, #50 owns persistent angle tracking, and #46 owns end-to-end verification. #34 records the additional issue and development grouping. #51 tracks the separate landing page as a future proposal requiring approval.

- **Research uses “Track” intent.** Let the user provide or correct an angle, with inference from project context. Make source configuration secondary. Explain whether tracking is one-off, pending external setup, paused, or actually running. Do not imply an agent is monitoring continuously when there is no verified executor.
- **Recommendations belong in the discovery feed.** Lead with relevant recommendations and their applicability/evidence. Allow rejection and acceptance; persist triage so accepted/rejected items are not recommended again for the same applicable context. Acceptance leads into the contextual experiment flow.
- **Suggest Evaluation automatically.** Draft useful evaluation from repository context and accepted research. Drafting does not approve execution, commands, budget, or arbitrary metrics. Avoid fabricated measurements and preserve exact approval requirements.
- **Show useful progress.** Add restrained transitions and honest working/saving/queued messages. Respect reduced-motion preferences. Distinguish agent work from service work; a spinner must not imply an agent exists or has accepted a job.
- **Make the workbench feel like an application.** Keep titles and introductory copy proportional to the task; avoid landing-page hero treatment in daily work surfaces. A separate public landing page is a future proposal, not part of automatic scope expansion.

If implementing a note requires functionality outside existing issues, draft a concrete proposal and wait for approval before implementing that expansion.

## Single-worker procedure

1. Check the actual time, repository access, checkout status, and pending work. Cloud tasks are already isolated: use their existing checkouts, without creating worktrees unless requested. Preserve existing user changes.
2. Read open PRs and the selected issue/dependencies. Resume the existing PR/checkpoint before starting new work. Verify any stale claim or interrupted changes; never steal an active task or force-push another contributor's branch.
3. Take one bounded work unit. Record its acceptance criteria, branch/PR, and progress in durable repository/GitHub state. Independent task threads must not rely on process memory or local-only notes surviving.
4. Implement and run checks appropriate to changed behavior. Existing CI runs build, types, lint, service/contract tests, browser workflows, and release smoke checks. For UI changes inspect actual populated desktop and narrow-screen screenshots; passing browser assertions alone is not visual review. Keep measured results distinct from synthetic fixtures and research claims.
5. Open or update one PR with concrete behavior and validation. Attach the PR to the task where supported. Review the exact current diff and wait for required CI outcomes. Fix diagnosed failures; checkpoint CI that is still pending instead of polling indefinitely.
6. The owner permits merging. Merge only a reviewed, conflict-free current head with required checks passing. Use supported conditional merge mechanisms to avoid racing a changed head. Do not use administrator bypass to skip failed checks. Approval-sensitive changes need a dedicated review phase; do not create fake approvals under the author's identity.
7. Close completed issues, update the roadmap/project status when permissions allow, and record the next dependency-ready unit. If incomplete, retain the issue and PR and write a checkpoint with exact failing/unrun checks and the next command. Do not close work based on partial criteria.
8. Notify the owner for a blocking product decision, required credential, unavailable executor, actual service limit preventing work, or proposed scope expansion. Otherwise leave a short result. Use supported task notifications; do not introduce unrelated email/Slack messaging.

A checkpoint should identify: issue(s), exact branch/head/PR, changed behavior, passed/failed/unrun checks, screenshots and measured evidence, next action, blocker. Do not store secrets or connection credentials.

## Cloud startup and verification

From `/workspace/Paperloop`, activate the pinned tools and browser cache:

```bash
export PATH=/workspace/.paperloop-tools/node_modules/.bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
export PAPERLOOP_DATA_DIR=/workspace/.paperloop-state
pnpm run doctor
```

Use the environment's saved install/start instructions. Dependencies, builds, and browser binaries may be retained, but live services must restart. Run `pnpm dev` for development or `pnpm start` for the compiled app, after checking for an existing owner of the port/data directory. Verify health, UI, and authenticated operations without printing the local credential. Do not publish loopback preview links.

Validation from the checkout: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:browser`. Playwright's bundled Chromium downloaded successfully after network settings changed; no system-Chromium override is required. Refresh tools/dependencies through the environment's setup script without changing the tracked lockfile as an incidental setup action.

## Durable scheduled-task prompt

Use this prompt with the remote/new-task option and this cloud environment. Set the actual model to GPT-6.1 Sol, reasoning medium, in the runner. Configure a recurring schedule only when the owner requests one. The first run must validate executor access. No task has been registered by writing this document.

> Develop emmanuel-sp/Paperloop using docs/DEVELOPMENT_AUTOMATION.md from the latest repository as the operating policy. Work in the provided cloud checkout. Read current issues, PRs, and the latest checkpoint. On the first run, verify cloud GitHub/checkout/build/browser capabilities before implementation. If the cloud executor is unavailable, an actual service limit prevents work, or a competing task owns the work, report the blocker and stop without starting implementation. Resume pending work first; otherwise select one dependency-ready unit from milestone 6. Use one worker and one active implementation PR. Keep authentication, evaluation approval, and paid activation changes in dedicated review phases. Implement, test, and visually inspect affected populated desktop/mobile flows. Create/update a PR and merge a reviewed current head only when required checks pass; checkpoint pending CI without repeated polling. Update completed issues and status. If milestone 6 is done, fix confirmed defects and bounded usability problems within approved scope, and propose the next milestone for owner approval. Never start new functional scope or paid execution without approval. Leave a durable checkpoint and a short result, requesting input only for a concrete blocker or scope decision.

## Paperloop developing Paperloop

Milestone 6 is the first gate. Then propose a dogfooding milestone: register this repository as a Paperloop project, track approved research angles, draft an evaluation based on its real build/test/browser/release checks, approve the exact execution plan in the workbench, run an isolated real baseline/candidate comparison, inspect evidence, and integrate with the verified cloud executor. A scheduler handoff or health response does not establish that the agent is connected or executing.

Continue finding bugs and usability improvements within approved scope. New milestones should be concrete proposals with acceptance criteria, dependencies, evaluation, and expected cost. The owner approves expanded functional scope; no infinite self-generated feature backlog.
