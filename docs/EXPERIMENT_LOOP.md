# Supplied-paper experiment loop

Paperloop owns durable state and measurement. Your connected coding agent reads the paper, writes the implementation brief, and changes only the isolated candidate. No model provider or paid API call is required by the evaluation harness.

1. Register a local project, ingest the supplied paper in **Research**, and ask the agent to store a project-specific brief using `research_store_implementation_brief`.
2. Draft a plan in **Evaluations** or with `evaluations_draft`. Specify dataset identity, cases, metric units/directions, absolute improvement and regression thresholds, sample requirements, guardrails, and an executable plus argument array. MCP supports relative working directory, timeout, and explicit environment-variable references.
3. Review and approve the exact version in the connected workbench. An agent cannot approve through MCP. A changed configuration is a new unapproved version; existing experiments remain bound to their approved version. Approval authorizes local execution, not a security sandbox: review the executable and inputs carefully.
4. Select the paper and approved plan in **Experiments**, or call `implement_paper`. This resumes an unfinished matching experiment rather than duplicating it. Git projects get detached baseline/candidate worktrees at the selected commit, preserving dirty original files. For non-Git projects, first prepare a separate copy outside the original directory and explicitly supply its path; Paperloop makes two isolated copies and records a content manifest. Copies must not contain symlinks.
5. Run the baseline. Ask the agent to claim with `experiments_claim`, keep the returned ownership token, change only `candidatePath`, and check in with `experiments_progress`. Claims expire after five minutes without progress. One implementation per project may be active. Report `ready: true` when the candidate is complete.
6. Run the candidate, poll `evaluations_run_get`, and use **Compare runs** or `experiments_compare`. Inspect metrics, guardrails, provenance, registered artifacts, stdout, and stderr in the workbench. Nothing is automatically merged into the original project.

## Framework-neutral result contract

The approved command runs directly (`shell: false`) from its relative working directory. It must produce a fresh result at `resultPath`, for example:

```json
{
  "schemaVersion": 1,
  "metrics": [
    { "name": "quality", "unit": "points", "value": 12, "samples": [12, 12] }
  ],
  "artifacts": ["evidence.txt"]
}
```

Metric names must be unique; values and samples must be finite numbers. Units must match the approved plan. Artifact paths must resolve inside the isolated workspace. Results are limited to 2 MB and individual artifacts to 10 MB; captured stdout/stderr retain the final 1 MB each. Artifact reads are bounded to 100,000 characters. Only `PATH`, `LANG`, and explicitly named environment references are inherited; values are never stored in plan configuration. Evaluator output may contain sensitive information, so do not print secrets.

Each run records code revision/content identity, plan fingerprint, dataset/environment identity, producer, timestamps, status, and artifact references. `evaluations_external_result` stores declared external evidence, visibly distinguished from independently executed harness evidence. Mixing those producer classes yields an inconclusive comparison.

Comparisons use absolute thresholds in each metric's units. A guardrail regression overrides an improved primary metric. Missing/incompatible evidence or insufficient samples yields **inconclusive**; otherwise the outcome is improvement, regression, or no meaningful change. Percentage change is undefined when the baseline is zero. Sample-count checks do not establish statistical significance.

## Interrupted execution

Nonzero exits, malformed/missing/stale output, timeouts, and cancellation are persisted as unsuccessful runs, never improvement evidence. Timeout/cancellation terminates the launched process group. Before reporting completion, the harness uses the Unix `ps` utility to confirm no live group member remains (unreaped zombies cannot execute). Confirmation is bounded; unavailable inspection or surviving processes mark the run and experiment interrupted, requiring reconciliation instead of claiming cancellation succeeded. Restart marks in-flight runs and owned implementation jobs interrupted; it never kills a saved PID. Inspect both workspaces and any surviving processes, then record specific evidence through the workbench or `experiments_reconcile` before claiming or executing again. Old ownership tokens cannot be reused.

## Verification

`pnpm test` includes an actual MCP client and Python subprocess fixture covering browser-session-only approval, plan version changes, dirty-original preservation, isolated candidate changes, durable comparison/restart state, ownership conflicts and reconciliation, non-Git copies, guardrails, samples, provenance, malformed output, timeout, and process-group cancellation. Python 3 and Git are required for these tests.

## Contextual Evaluation suggestions

Research actions carry the originating paper, recommendation, and angle into preparation and Evaluation. Preparation shows that paper directly; it does not ask the user to pick again. Missing or stale recommendation context requires recovery in Research.

Evaluation offers the current project configuration for explicit relevance review, a validated local `paperloop.evaluation.json` contract, or a bounded `package.json` test-suite guardrail. Repository metadata is read without executing it or following document symlinks. A test-suite suggestion measures the real command exit outcome only; it does not claim research quality or improvement. Unsupported capabilities and missing metrics/results contracts prompt agent-assisted or deliberate custom setup.

Using a suggestion persists an unapproved draft or reuses an identical version, with paper/angle/project provenance. Changed measurement contracts produce new fingerprints and require fresh approval. Suggestions, acceptance, and contextual preparation never grant command approval or paid activation. The approved test adapter is shipped with the local service and writes the normal result protocol from observed outcomes.

## Visible implementation lifecycle

Experiments show Prepare → Measure baseline → Implement → Evaluate candidate → Review, with individual run states alongside the agent lifecycle. The handoff names the pinned paper/context/brief, approved Evaluation, isolated candidate, claim/check-in protocol, and constraints. Copying the task does not launch an agent.

Claims and heartbeats retain actual check-in timestamps. Expired claims become interrupted when observed; they require inspection and reconciliation instead of displaying indefinite activity. `experiments_progress` accepts optional structured `evidence` with summary, changedFiles, checks, and limitations. Ready reports without structured evidence retain the agent's supplied message as the summary and show missing change/check evidence honestly. Readiness is not a measurement or permission to merge.
