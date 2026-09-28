# Paperloop — Functional Scope

Status: initial v1 scope

## 1. Product idea

Paperloop helps developers apply research papers and engineering articles to their projects and find out whether the changes actually help.

The initial audience is developers building AI applications: retrieval systems, agents, model-powered features, and similar projects where quality, cost, and latency can be evaluated.

The core loop is:

**Understand the project → define improvement → discover research → implement an experiment → evaluate and compare.**

Paperloop runs on the user's own machine. It provides a local UI, an MCP server, and a harness for research, scheduling, experiments, and evaluations. There are no Paperloop accounts, registration, login, or team workspaces in v1. One local installation can manage multiple projects.

The UI is a core part of the product. Like Postman, it should make an ongoing technical workflow substantially easier to understand, organize, and repeat. Users should have a reason to return to the workspace even when their coding agent can access the same capabilities.

## 2. Project setup and context

A user can start with a project description. They provide what the project does, what they want to improve, known problems, and constraints such as cost, latency, dependencies, or deployment requirements.

Code access is optional during onboarding. Support both of these paths in v1:

- A local repository or directory, selected in the UI or supplied by a connected coding agent.
- An optional read-only GitHub connection for repository context.

Any credentials needed for GitHub, research providers, or models are configured on the local installation. These are external integrations, not Paperloop user accounts. Local hosting does not imply offline operation; the UI should make clear when an integration sends project context to an external service.

Keep a persistent project profile containing objectives, constraints, architecture context, selected sources, approved evaluation plans, and experiment history. Show where context came from and when it was last updated, including the repository revision when available. Allow users and agents to refresh it as the project changes.

Description-only projects can receive recommendations and draft evaluation plans. Executing an experiment requires an available local working copy and a runnable evaluation setup. A GitHub connection alone does not provide an execution environment.

## 3. Research discovery and monitoring

Discover public papers and engineering articles through curated source collections. Suggest relevant collections during setup, then let users select or deselect collections and individual sources. Users can also add supported feed URLs and submit individual paper or article links.

Collections can group sources around topics such as retrieval, agents, evaluation, or inference. Each project maintains its own selections. Recommendations should retain their source links and explain their relevance.

Run an initial search across historical and recent material available through the selected sources. Support on-demand searches, scheduled monitoring, and direct paper submission; users do not have to wait for a recommendation before trying a paper.

Each recommendation should describe:

- The project problem it addresses and why the research is applicable.
- The proposed change, prerequisites, estimated effort, and important uncertainties.
- The expected benefit and evaluation criteria that could test it.
- The supporting paper or article and any relevant implementation references.

Distinguish benefits reported by a source from benefits measured in the user's project. A paper's benchmark results are a reason to investigate, not proof that the change will help this application.

Deduplicate recurring discoveries. Preserve saved, dismissed, and previously tested recommendations, including the user's reasons, so scans do not repeatedly present the same work as new.

Default monitoring to daily scans. Also support weekly scans, scan-now, pause, and agent-created schedules. The coding agent's native scheduler is the default driver; Paperloop supplies the tools, instructions, and persistent state. Show intended next-run time, scheduling setup status, actual check-ins, last-run results, and source failures. Local workflows require Paperloop and the selected agent scheduling environment to be available. Coalesce missed occurrences into one catch-up scan when that driver becomes available rather than replaying every missed scan.

Users can explicitly enable a local model API mode for research analysis and drafting as a fallback. Providing an API key alone does not activate paid background work. Search and ingestion remain available without a key; analysis waits when neither an agent nor an enabled model provider is available. API-backed analysis does not implement code or approve its own evaluation criteria.

## 4. Evaluation setup and the local harness

Define what improvement means early. Paperloop proposes project-level metrics, success thresholds, and guardrails based on the project description and available code. Users approve or edit the proposal and can supply their own criteria and existing evaluations.

Useful measures include task quality, latency, cost, and functional regressions. There is no universal improvement score: a project may prioritize one measure while requiring others to stay within agreed limits.

If evaluations do not exist yet, Paperloop drafts criteria and example cases. After review, the coding agent builds the runnable evaluation setup using approved test data. Generated or synthetic cases must be identified as such; they should not be presented as representative production evidence without validation.

Paperloop provides the local evaluation harness. It can register an evaluation's invocation and result contract, execute an approved evaluation command, capture logs and artifacts, track status, and normalize results for comparison. Existing evaluation suites should be usable without requiring a particular evaluation framework.

The coding agent can use this harness through MCP, and the UI can invoke the same underlying operations. Execution commands must come from the approved project evaluation configuration rather than executable instructions extracted from a paper.

Record the evaluation version, dataset or case-set version, code revision, relevant environment and model settings, and available usage data for each run. Baseline and candidate must use comparable conditions. Surface mismatches or uncertainty rather than declaring an improvement from incompatible runs.

Changes to approved success criteria or evaluation cases require renewed approval and a comparable baseline before they can support an automated improvement decision.

## 5. Implementation and experiment lifecycle

An experiment starts from a recommendation or a paper supplied directly by a user or coding agent. Paperloop turns it into a project-specific implementation brief with the proposed change, research references, constraints, and evaluation plan.

Each experiment links:

- The research and implementation brief.
- The approved evaluation plan and success criteria.
- A baseline revision and an isolated candidate branch or worktree.
- Execution progress, evaluation runs, comparisons, and supporting artifacts.

The user's coding agent performs implementation. Paperloop supplies the instructions, project context, experiment state, and evaluation harness. An MCP implementation operation begins or resumes this workflow and returns actionable instructions to the calling agent; it does not silently launch a separate coding agent.

The local harness runs evaluations and records their results. Agents can also submit externally executed results with their provenance and artifacts. Clearly distinguish harness-run results from agent-reported results.

Track whether an experiment is awaiting approval, queued, claimed, running, completed, failed, cancelled, or interrupted. Keep the experiment's execution state separate from its outcome: improvement, regression, no meaningful change, or inconclusive evidence.

Missing evidence and failed evaluation execution must never count as success. Where repeat runs or uncertainty estimates are needed to interpret a result, expose that limitation in the comparison.

Keep completed experiments available for review and reproduction. Applying or merging the candidate change remains an explicit user action; v1 does not automatically merge experiments.

## 6. MCP capabilities

The MCP should be useful as an agent's research and experimentation toolkit, as well as a connector to the UI. Expose coherent operations that can be combined into longer workflows. UI and MCP actions share the same local project state and history.

The names below describe intended capabilities. The technical design defines tool families and shared contracts; individual tool schemas will be finalized as those capabilities are implemented.

| Capability | Intended behavior |
| --- | --- |
| Project context | Create or select a project, inspect its goals and constraints, register a local directory, and contribute or refresh relevant context. |
| Search for papers | Search selected collections using a question, project objective, or technical problem; return sources and reasons for relevance. |
| Inspect a paper | Ingest a supplied link or paper reference, retain its provenance, and explain the method, prerequisites, and possible application. |
| Manage sources | Inspect available collections and update the project's selected collections or supported feeds. |
| Schedule | Create, inspect, update, pause, or remove Paperloop schedules; prepare native-agent scheduling instructions and record the reported setup and actual check-ins. |
| Define evaluations | Draft metrics, cases, thresholds, and guardrails; register existing evaluation commands; expose approval status. |
| Implement a paper | Accept a paper and project, prepare or resume an experiment, and return the implementation brief, required approvals, and next actions for the calling agent. |
| Run evaluations | Start an approved baseline or candidate evaluation through the local harness and return a run identifier. |
| Compare | Compare compatible runs, report metric changes and guardrail results, and identify missing or insufficient evidence. |
| Manage work | List and claim eligible experiments, report progress, inspect status and logs, and request cancellation. |
| Record results | Attach code references, externally produced results, artifacts, and implementation notes to an experiment. |

Long-running operations should return identifiers that the UI and agents can use to inspect progress and retrieve results. Experiment claims must prevent concurrent agents from implementing the same experiment. An expired or interrupted claim must be reconciled before retrying potentially completed work.

Approval state is shared across the UI and MCP. A tool call alone must not bypass required user approval of an evaluation plan or authorization for automatic work.

## 7. Scheduling and automatic experiments

Paperloop integrates with the coding agent's native scheduling features, initially through Codex and Claude Code setup recipes. A scheduling handoff asks the agent to configure its scheduler and report the outcome; the UI shows setup pending until that outcome is reported. Distinguish durable desktop scheduling from session-scoped agent loops. Generating instructions does not establish that an external schedule is installed or running.

Automatic experimentation is opt-in per project. Users choose eligible objectives and change categories, approve the evaluation plan, and set run-count limits. Recommendations that match these rules can enter the execution queue automatically. Other recommendations remain available for manual review.

Default to one active implementation experiment per project. Enforce the configured queue-dispatch limits in Paperloop and expose the relevant constraints to the agent.

An active coding agent, including one invoked by its native scheduler, claims queued experiments through MCP. Queued implementation waits when no agent is available. Paperloop does not launch a coding agent, and an MCP connection must not be treated as proof that an agent is actively processing work.

The explicitly enabled API-backed fallback runs research analysis and drafting while the local Paperloop service is available. It does not replace the coding agent for implementation. Both execution paths share job history and duplicate-work protection. V1 does not silently switch to paid API execution after a missed agent check-in.

The harness can execute an approved evaluation without a coding agent once the necessary code, inputs, and evaluation configuration are available locally. Evaluation execution and agent-led implementation are separate capabilities.

Pausing automation prevents new automatic dispatches and makes later callbacks no-ops; it does not imply that already-running work has stopped. Show ongoing work separately and allow cancellation requests. If an external agent schedule also needs updating or removal, provide a handoff and show external synchronization as pending. Interrupted or failed work must remain visible, with no silent duplicate execution or unlimited automatic retries.

## 8. UI and daily workflow

Build a persistent project workbench with project navigation, tabs, and a detail pane. Preserve the user's place when switching between research, evaluation plans, and experiments.

The main areas are:

- **Overview:** project objectives, context freshness, new recommendations, pending approvals, waiting work, and recent outcomes.
- **Research:** searchable recommendations, applicability explanations, sources, saved items, dismissals, and direct paper submission.
- **Evaluations:** approved and proposed criteria, test cases, harness configuration, baselines, and run history.
- **Experiments:** the implementation brief, agent progress, code references, logs, and result comparisons.
- **Sources and schedules:** collection selection, monitoring settings, automation rules, and run status.

The comparison view is a central product feature. Show baseline versus candidate, metric changes, failed guardrails, provenance, and uncertainty together. Users should be able to understand both what changed and whether the evidence supports adopting it.

Make queued work visibly different from running work, particularly when it is waiting for a coding agent. Keep background status within the workspace in v1; external email, chat, and push notifications are outside this initial scope.

## 9. Acceptance criteria

The first version is functionally complete when a user can:

1. Start Paperloop locally and manage multiple projects without registering or logging in.
2. Create a description-only project, choose source collections, and receive relevant historical and recent research.
3. Enrich project context through either a local directory/agent or an optional GitHub connection.
4. Approve suggested evaluations or bring existing ones, then establish a baseline using the local harness.
5. Submit a paper directly through the UI or MCP and obtain an actionable implementation experiment.
6. Have a coding agent implement the change and use the harness to evaluate and compare it with the baseline.
7. Inspect the resulting evidence and distinguish improvement, regression, no meaningful change, and inconclusive results.
8. Set up native-agent research scheduling, distinguish pending setup from observed runs, and enable rule-based automatic experiment queuing within configured limits.
9. See queued work wait for an agent, resume the workflow safely, and retain project history across service restarts.
10. Explicitly enable API-backed research analysis and drafting as an alternative, with no paid background work activated merely by configuring a key.

Verification must cover source selection and deduplication, evaluation approval, compatible comparisons, queue limits, duplicate claims, scheduling handoffs and check-ins, paused callbacks, schedule recovery, API-mode activation, stale context, unavailable sources, failed commands, disconnected agents, cancellation, and incomplete result submissions.

## 10. Boundaries and next design work

V1 excludes Paperloop accounts, team collaboration, hosted execution, an unattended coding-agent launcher, automatic merges, paid/private research-source integrations, and operation as a publicly accessible multi-user service. It does include local evaluation execution and optional external services configured by the user.

The initial implementation should prove the complete loop with one supported coding agent and at least one working evaluation integration, while keeping the MCP interface usable by other clients. It does not promise tested compatibility with every coding agent or evaluation framework.

The [technical design](TECHNICAL_DESIGN.md) defines the selected stack, feature boundaries, storage, initial research adapters, agent integration approach, evaluation contract requirements, local service lifecycle, and implementation milestones. Initial platform support is macOS, Linux, and WSL. Detailed schemas, collection contents, and screen layouts will be developed within those boundaries during implementation.
