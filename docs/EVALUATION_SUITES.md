# Layered Evaluation proposal (#66)

Status: design record for the first bounded #66 phase, grounded in main
`0aa10bc7590e587bc145b4298b8ae8d20bd1aff9`. This records the proposed implementation
baseline before changing runtime contracts. It ships documentation, illustrative
JSON and a populated browser sketch only. It neither approves commands nor
implements suites. #66 remains open. #47 owns the detailed comparison UI; #46 owns
shared scenarios and final verification. Search/AI-quality research is outside scope.

## Current behavior and concrete limitations

| Area | Current evidence | Consequence for the design |
| --- | --- | --- |
| Contracts | [evaluations.ts](../packages/contracts/src/evaluations.ts): one command/result path, one dataset and environment identity; 1–100 metrics, 1–1,000 case labels, up to 10,000 samples per metric; result schemaVersion 1 | Several metrics already work. Labels are not per-case outcomes. There are no named checks, dependencies, group outcomes or report adapters. |
| Suggestions | [suggestion-service.ts](../apps/server/src/evaluations/suggestion-service.ts): bounded no-follow reads of `paperloop.evaluation.json` and package metadata; validated manifest → matching/current plan → npm test adapter → honest missing-contract fallback | No paid inference is necessary. Preserve originating paper/recommendation/angle and context version; an existing plan is not evidence of applicability. |
| Repository inference | [onboarding-service.ts](../apps/server/src/projects/onboarding-service.ts): observed package test/bench/eval scripts and pytest metadata | Observed capabilities are suggestions, not executable measurement contracts. Broaden bounded capability inventory to build/typecheck/lint without inventing scripts or report paths. |
| Test adapter | [test-adapter.ts](../apps/server/src/evaluations/test-adapter.ts): runs one child command, writes test_passed=0/1 with one observation, no cases; ordinary failed tests become a valid metric | Exit outcome cannot establish hundreds of passes or identify failed cases. Preserve its legacy semantics; richer required correctness needs explicit checks. |
| Runner | [runner.ts](../apps/server/src/evaluations/runner.ts): shell:false, approved argv/cwd/env references/timeout; bounded logs, fresh result ≤2 MB, artifact ≤10 MB; containment and process-group stop confirmation | Reuse process control and artifact registration. Parse reports after every check, persist partial evidence, and enforce an overall suite bound. Local permissions remain the boundary; worktrees are not an OS sandbox. |
| Plans/approval | [plan-service.ts](../apps/server/src/evaluations/plan-service.ts): immutable per-project versions, SHA-256 of parsed JSON, exact fingerprint approval; workbench-only approval route, no approval MCP tool | Preserve v1 bytes/fingerprints. Every new suite or material revision needs a new unapproved version. Stable serialization is a v2 concern, not a reason to rehash old approvals. |
| Execution/provenance | [experiment-service.ts](../apps/server/src/experiments/experiment-service.ts): isolated role workspaces, harness/external producers, code/plan/dataset/environment identities; running work and claimed implementations become interrupted at restart | One suite execution remains one durable run. Preserve reconciliation and partial results; never silently resume commands after restart. Current identities are recorded declarations/content hashes, not attestations of environment equivalence. |
| Comparison | Same service: compatibility/sample checks; any missing evidence gives inconclusive, then regression, improvement, no-change. [ExperimentWorkspace](../apps/web/src/experiments/ExperimentWorkspace.tsx) shows aggregate metrics and separate run artifacts | Distinguish required validation from improvement. Carry per-check evidence to #47; do not duplicate its comparison screen here. |
| Budgets | [automation-service.ts](../apps/server/src/schedules/automation-service.ts) reserves attempts transactionally; experiment service charges each harness/external run and retains min(current, original) run ceiling plus goal/category/plan authorization | Baseline and candidate each cost one attempt regardless of check count. No per-check retries, partial free runs or automatic rule upgrades. |
| HTTP/MCP | [workflow routes](../apps/server/src/experiments/workflow-routes.ts), [workflow MCP](../apps/server/src/mcp/workflow-mcp.ts), analysis and scheduling schemas reuse the shared plan/result schemas | Version the shared union end to end; list/draft/read/run/import tools must accept/return the same formats. Old clients must receive an actionable unsupported-format error, not flattened success. |
| Editor | [EvaluationWorkspace](../apps/web/src/evaluations/EvaluationWorkspace.tsx): suggested/current plan, custom metric plus optional guardrails, required dataset/cases/command inputs, exact JSON details and approve action | Do not translate suite properties into required fields. Suggested explanation and lightweight correction are primary; exact steps and expert editing remain inspectable. |
| Fixtures | [SCENARIOS.md](SCENARIOS.md), merged #67: 300 real local synthetic measurements and seven outcomes, legacy plans; readiness/setup simulations labeled | Extend these fixtures for checks, dependency failures and partial evidence. Existing tests do not verify a layered runner or suite UI. |

External v1 import validates the result shape but does not independently execute
commands or copy artifacts; compatibility and missing criterion evidence are
resolved during comparison. Preserve that provenance distinction. Suite imports
will need stricter expected-check membership and coverage validation.

## Examples before selecting the model

The examples are proposed format-v2 drafts for illustrative repositories with
supplied scripts/report settings. They are not claims about the current checkout
and are not accepted by today's strict v1 schema.

**Conventional checkout application.** [application.json](evaluation-design/examples/application.json)
runs build, types and lint; then 480 unit cases, 24 integration cases and 30 browser
journeys; then an existing 60-sample latency benchmark. The illustrative repository
supplies those report paths and configures Playwright's JUnit output file to
`reports/browser.xml`. Counts are scenario expectations, not observed test results.
The ordinary user sees: “Check that checkout still works, then compare response
time. Existing unit, integration and browser tests protect correctness. A faster
candidate is useful only if those checks pass.” The user can accept that suggestion
without entering seven commands or 594 case labels. A correction such as “Keep the
whole Evaluation within ten minutes” changes the draft's overall limit from 15 to
10 minutes; its exact scope must be reviewed and approved again.

**Research/ML project.** [ml.json](evaluation-design/examples/ml.json) checks harness
syntax and model correctness, then uses the 300-case local benchmark from #46.
The illustrative extension supplies a model test suite and configures its JUnit
output; the current #67 generated repository does not yet include that test file.
Mean absolute error is the improvement target, operations is a guardrail. A user
sees: “Verify the model first, then measure prediction error on the same 300 cases.
Keep the operations per case from increasing.” Changing “Require at least 0.02
less error” revises a metric threshold from 0.01 to 0.02. Cases remain report data,
not manually entered fields. The 300-case artifact already exists in the legacy
fixture; it does not become structured suite evidence until an adapter supplies it.

[Populated interactive sketches](evaluation-design/sketch.html) demonstrate both
journeys: suggested explanation → optional fixed example correction → revised
unapproved draft → exact steps/JSON review → simulated approval display. They also
show no-contract and prerequisite-failure states. Values/counts are explicitly
illustrative, not new measured evidence. Preview controls do not call Paperloop.

## Chosen model and alternatives

Use an immutable **suite** with an ordered list of named checks, optional display
groups and backward-only `dependsOn` references. Run serially. A group is display
metadata, never an executable or a second dependency graph. Reordering, changing a
check ID, or changing its membership requires a new version. Compare metrics by
`checkId + metricName`; duplicate names across checks are permitted, duplicates
within one check are rejected. Start with shared suite dataset/environment
identities; a check may explicitly override either, and those overrides belong to
approval and run provenance. No inherited command or environment variables.

A single-command wrapper hides which prerequisite failed, expands approval to an
opaque orchestration script and cannot represent partial results cleanly. A free
DAG with parallel workers adds recovery/race/budget complexity with no current
requirement. Keep v1 as a native legacy path rather than silently converting it.
The selected serial model supports both examples with bounded execution and a
small review surface. Optional checks are permitted but cannot supply a claimed
improvement when their evidence is absent; suggested correctness checks default
to required. Do not automatically remove required checks to make a candidate pass.

### Proposed shape and validation

New drafts explicitly set `formatVersion: 2`; absent formatVersion selects the
unchanged v1 shape. Result `schemaVersion: 2` contains check records; v1 remains
unchanged. Reuse current command fields except result path belongs to the report
adapter; an exit-code check has no fictitious metric result file. Each check has:

- A stable id (1–80 ASCII identifier characters), name, group, required flag,
  backward dependency IDs, one exact command and one versioned report adapter.
- Zero or more existing metric criteria. Required correctness is represented by
  check outcome, not a fabricated numeric test_passed score.
- Optional explicit dataset/environment override and expected coverage contract
  (e.g. suite IDs/minimum cases and identity policy), supplied by the agent/manifest.

Cap serialized v2 drafts/repository manifests at 256 KB and retain 32 KB bounds
for ordinary repository metadata. Use bounded no-follow reads for both. Validate
1–50 checks, unique IDs, dependency existence/order, no self-reference,
unique per-check metrics, and all bounded text/paths. Use current per-check
100 ms–1 hour command bounds and a 100 ms–1 hour overall bound. Limits apply to
baseline and candidate separately; expiry consumes the run attempt. Explain when
sum of per-check maxima exceeds the overall bound; the overall cap wins. Store
adapter version, report path/format, coverage policy, dependencies, all thresholds,
limits, identities, environment references and complete argv in the fingerprint.
Freeze parsed/defaulted v2 data and serialize deterministically with fixed key
ordering; preserve check/argument/dependency array order. No approval over display
summaries alone. Retain review explanation and correction/context provenance as
version-bound metadata; changing only a display explanation cannot mutate an
approved executable configuration.

## Reports, cases and evidence

Initial adapters: **exit-code v1**, **JUnit v1**, and **metrics-v1 v1** (the current
schemaVersion-1 measurement JSON embedded under a suite check). Every command is
supplied before approval; adapters only parse evidence and never discover/execute
extra commands. Prefer existing repository JUnit reporting for unit/integration/
browser suites. Do not append guessed reporter flags to unknown scripts. Pytest,
Vitest and Playwright can use the same JUnit path when configured in the inspected
repository. Other reporters fall back to truthful exit-only checks until a
supported contract is supplied; custom adapters are future versioned code, not
arbitrary executable plugin loading.

JUnit parsing must disable DTD/entities/external resources, bound nesting/text/
case counts, use only the approved workspace report path, reject duplicate or
inconsistent totals, and retain the original report. Normalize IDs from suite
path + class/file + case name + duplicate occurrence; retain the raw identifiers.
Duplicate occurrences may be matched only when stable ordering is evidenced;
otherwise case pairing stays unknown. Failure/error cases remain failed, framework
skips remain skipped. A zero-exit process with failing cases is failed. A nonzero
exit with apparently passing cases is also failed. An empty, stale, missing or
malformed required report is unknown, never passed. Exit-code checks can pass
without case evidence but explicitly have unknown case coverage.

Metrics preserve existing finite values, units, samples and thresholds. A metric
report can carry a separately registered, versioned case artifact; arbitrary
`cases.json` is downloadable evidence, not automatically interpreted case data.
Add a bounded documented `cases-v1` sidecar for the #46 fixture (id, label,
status, optional metric values/units); do not infer pass/fail from an error array
without approved semantics. Predictions/errors can be inspected without inventing
correctness verdicts. Case-set/dataset identity and coverage policy must match
before pairing; missing/extra cases stay explicit and cannot count as passes.
No fabricated cases, sample counts, confidence intervals or significance.

Limit each parsed report to 2 MB, registered artifact to 10 MB, normalized cases
to 10,000 per check and 50,000 per run; retain current metric/sample limits and
bound total registered artifact bytes to 50 MB per run. Exceeding any bound is
visible unknown evidence, not silently truncated success. Keep per-check logs
bounded and enforce a 10 MB total log allowance per run with explicit truncation
metadata. Case records should live in paged storage, not inflate every run/MCP
response; return totals, coverage, first bounded page and artifact references.
Use stable cursor paging (≤100 cases/page) with filter/check identity and compare
pairing status. Artifact retrieval stays registered, size-bound and read-only.

## Execution, recovery and budget decisions

Reserve one durable parent run transactionally before launching any subprocess,
using the existing authorization and retained run ceiling. Persist every planned
check as pending with its exact approved specification/fingerprint. For each
check in list order, revalidate plan/rule authorization, remaining overall time,
workspace containment and dependencies. Dependencies must have **passed**;
failed, unknown, timed-out, skipped or interrupted prerequisites skip dependants
with the specific dependency IDs/reasons. Continue independent checks unless
cancelled, the overall cap expires, or process stop cannot be confirmed.

Before spawn, persist running state and start time. Run with shell:false and
per-check timeout min(check bound, remaining overall bound). Only declared
variables are inherited in addition to the existing minimal environment. Capture
code identity at start and end and label dirty/generated changes; record the
suite/check dataset and environment identities and producer separately. Matching
a declared environment string alone does not prove identical dependencies. Record
available lockfile/tool/dataset content identities and mark missing attestation;
never claim an isolated worktree prevents network or local-system access.

Persist outcome, exit/signal, report validity/coverage, metrics and registered
artifacts after each child stops. Report freshness must be tied to this check
attempt (pre-run removal/owned output directory plus file metadata); never accept
an earlier run's file. Apply existing real-path containment and symlink rules.
If process-group stop cannot be confirmed, interrupt the parent and prevent all
remaining commands until reconciliation. Cancellation/overall timeout stops the
active group and marks undispatched checks skipped with a parent-stop reason.
Retain earlier evidence; do not erase it or turn missing checks into successful
results. No automatic retry, implicit install or paid fallback.

On restart, mark running check/parent interrupted, keep completed records, mark
remaining checks unexecuted and require the existing experiment reconciliation.
A retry creates a **new full suite run**, consumes another attempt and reruns all
checks; it cannot splice old evidence into a nominally fresh baseline/candidate.
One baseline plus one candidate consumes two runs, not 2×number-of-checks. Tightened
rules take effect before every dispatch; raised rules do not raise retained ceilings.
If a rule disables mid-check, stop the active process group and keep partial
results with an authorization-revoked reason. Rule edits never authorize a new
suite version automatically.

## Outcomes and comparison contract for #47

Separate parent lifecycle, check evidence and required-validation status. Parent
`completed` means traversal finished, not “all validations passed.” Normal test
failures can finish traversal and retain valid failure evidence; parent-level
spawn/persistence/parse infrastructure failure is failed, overall time expiry is
timed_out, cancellation is cancelled, unconfirmed stop/restart is interrupted.
Missing/malformed individual reports produce unknown check evidence; they do not
stop unrelated checks. Parser/storage implementation faults are infrastructure
failures. A per-check timeout remains timed_out at the check and unknown for required
validation; independent checks may still finish within the overall bound.

| Check state | Meaning | Dependants |
| --- | --- | --- |
| passed | Process and required report agree; correctness/coverage contract satisfied | May run |
| failed | Known nonzero/failed case/required correctness criterion | Skipped |
| unknown | Missing, malformed, stale, incompatible or insufficient required evidence | Skipped |
| skipped | Never dispatched because dependency/parent stop/precondition blocked it | Skipped |
| timed_out / cancelled / interrupted | Execution ended without complete trusted evidence | Skipped |

`requiredValidation` is failed if any required check has a known failure; otherwise
unknown if any required check is not passed; otherwise passed. An intentionally
optional skipped check is listed but does not fail required validation. Expected
framework case skips need an approved coverage policy; default unknown required
coverage if required cases did not execute. Case totals never substitute for
per-case records when asserting which tests passed.

Retain existing improvement/regression/no-change/inconclusive outcomes, add
requiredValidation and per-check comparability/reasons plus namespaced metrics:

1. Verify exact suite version/fingerprint, dataset/environment scope, check/adapter
   versions, role/producer identities and required coverage. Compare only the same
   approved check IDs and compatible metric units/sample contracts.
2. A candidate required correctness failure against a fully comparable passing
   baseline is regression, even if a benchmark improves. Preserve the failure as
   a blocking fact when baseline evidence is missing; overall outcome is then
   inconclusive. If both baselines already fail required correctness, no improvement
   can be claimed; distinguish existing failures in an inconclusive result.
3. Missing/unknown required evidence or incompatible provenance gives inconclusive.
   Do not let optional missing evidence hide a known comparable required regression;
   list optional gaps and suppress claims for their unavailable metrics.
4. With required validation passed on both sides, any comparable metric/guardrail
   regression wins over improvement. Any required comparison metric missing gives
   inconclusive. Otherwise one improvement criterion met yields improvement;
   none met yields no meaningful change. A correctness-only suite can establish
   validation/no-change, not research improvement. Never average away failures.

#47 receives required-check summary, check outcomes/coverage, metric direction/
threshold/sample counts, comparable case references and full provenance. Summary
example: “Error decreased, but required model tests failed. Revise the candidate.”
Show skipped prerequisites and unavailable evidence separately from known failure.
Keep exact values, original artifacts and logs inspectable. Percent change at a
zero baseline remains undefined. UI sketches only illustrate this contract; they
do not implement a second comparison screen.

### Concrete partial-result shape

Proposed persisted run excerpt for the **illustrative** ML prerequisite failure
(the harness derives aggregate status; this is not external input or a measured
fixture):

```json
{
  "status": "completed",
  "result": {
    "schemaVersion": 2,
    "requiredValidation": "failed",
    "checks": [
      {
        "checkId": "syntax",
        "status": "failed",
        "exitCode": 1,
        "evidenceStatus": "valid",
        "reason": "Harness syntax check failed",
        "metrics": [],
        "caseCoverage": "unknown",
        "caseCount": null,
        "artifactReferences": ["syntax/stderr.log"]
      },
      {
        "checkId": "correctness",
        "status": "skipped",
        "exitCode": null,
        "evidenceStatus": "not_produced",
        "blockedBy": ["syntax"],
        "metrics": [],
        "caseCoverage": "unknown",
        "caseCount": null,
        "artifactReferences": []
      },
      {
        "checkId": "prediction",
        "status": "skipped",
        "exitCode": null,
        "evidenceStatus": "not_produced",
        "blockedBy": ["correctness"],
        "metrics": [],
        "caseCoverage": "unknown",
        "caseCount": null,
        "artifactReferences": []
      }
    ]
  }
}
```

Full parent/check records also retain approved specification hashes, timestamps,
duration, effective identities, producer, report adapter version and artifact
registration metadata. Failed prerequisites do not create zero-valued measurements;
the benchmark has no result, and unexecuted case counts are unknown. External
imports supply check evidence and declared provenance, never a trusted aggregate
requiredValidation or comparison verdict.

## Agent-led drafting, corrections and review

Use the existing project/paper/recommendation context and preparation URLs; do not
ask again which paper, goal or repository is involved. Priority: validated v2
repository manifest → context-compatible saved suite → bounded observed scripts/
report settings → the simple supported single-command fallback. Present context
provenance and uncertainty. Do not reuse the latest plan solely because it exists
when it fails the selected research's scope; ask the agent for a draft while
keeping the current plan available explicitly.

The no-key path is deterministic metadata plus the already connected coding agent.
An agent may draft via MCP without a paid call. If report/benchmark configuration
is unknown, suggest verified exit-only correctness with “quality measurement not
available,” or request the missing contract. Never fabricate benchmark commands,
suite counts or metrics from paper claims. Offer “Ask your agent to draft” with
project/context/paper references, known capabilities, correction and limitations.

Ordinary review has a short summary, named correctness/measurement groups, evidence
source, overall limit and limitations. “Adjust the goal” is an optional short
natural-language correction; preserve it and submit a version-bound draft request
to the agent. A general correction stays **awaiting agent revision** until a
validated response exists; never echo it as though structured settings changed.
A small deterministic supported change (e.g. an explicit time limit) can draft a
revision without model inference, with a visible change summary. While a revision
is pending, keep the prior draft visible, label it prior and disable approval of
the supposedly revised scope. Stale responses are rejected by context/base-plan
version/fingerprint and request ID; retain the user's note and offer refresh.

“Review exact steps” expands an accessible list of all commands/argv arrays, cwd,
environment references, report paths/adapters, dependencies, identities and bounds;
JSON/fingerprint and optional expert editing are secondary. Approve is a deliberate
workbench action against that exact version/fingerprint. Saving a suggestion,
requesting/reviewing a revision or approving never automatically runs it. Experiment
preparation continues to reference the same approved immutable plan.

## Compatibility, implementation phases and acceptance evidence

Do not rewrite stored v1 plans/results/fingerprints, approvals, comparisons or
budget mappings. Read them as v1 and render “Single-command Evaluation” with case
coverage unknown when only test_passed exists. A user/agent may explicitly draft a
v2 equivalent for review; even one equivalent check has a new fingerprint/version
and requires approval plus fresh comparable runs. No migration executes commands.
Old v1 external results cannot satisfy a v2 suite; reject with expected-format
information. V2 external reports must contain exact approved check membership,
status/report/coverage and declared provenance; they remain externally reported,
not independently measured. Never trust their aggregate outcome; recompute it.

A versioned contract union affects workflow/suggestion HTTP and MCP plus analysis
outputs, scheduled submissions and automation approval schemas. Update consumers
atomically within each shippable phase; keep v1 behavior/tests intact. Add storage
migration for per-check attempts/case paging with backup/version checks, without
mutating historical records. New fingerprints cover adapter semantics explicitly;
changing an adapter version creates a new draft, not an upgrade of approved plans.

| Bounded phase | Delivery and review gate |
| --- | --- |
| A — this proposal | Source inventory, examples, populated sketch, decisions and verification matrix. Record before runtime implementation. |
| B — contract/storage | V1/v2 unions, suite validation/fingerprints, durable check/case records, HTTP/MCP/analysis/scheduling coverage; no executable v2 path until runner is available. Explicit unsupported execution preserves safety. |
| C — execution/evidence | Serial runner/adapters, partial evidence, bounds/cancellation/restart, imports, retained budgets, comparison facts; dedicated approval/process-control review. |
| D — suggested suite/editor | Contextual inventory/draft/correction, minimal review, optional expert controls, exact approval. Use the #46 scenarios and full viewport matrix during implementation. |
| E — #47/#46 integration | Detailed comparisons consume contracts; full layered fixtures and complete guided workflow after dependent work is ready. |

Required verification for B–E: legacy plan approval and artifact history unchanged;
no command runs on draft/use/correction; any material edit invalidates approval;
unknown adapter, cycles/forward deps/duplicate IDs/unsafe paths rejected; required
build failure skips dependants while independent lint runs; failing tests with
exit 0 and nonzero exit with passing report both fail; missing/empty/stale/invalid
reports stay unknown; 300+ cases with paging/pairing/duplicate/skipped/partial
coverage; metric/guardrail/zero-baseline comparisons; per-check and overall bounds,
user cancel, service restart and unconfirmed process stop; rule revocation and
retained budget across all outcomes/imports; v1/v2 external mismatch/provenance;
no-key metadata and delayed/stale agent correction; approval visibility and
keyboard/focus/scrolling at 360/390/768/1024/1440 and 900×500. Use controlled local
measurements for runner behavior and label synthetic UI data. No paid CI calls.


## Reproduce the design review

Open `docs/evaluation-design/sketch.html` directly in a browser. Select an example,
request its fixed correction, inspect the revised exact steps and simulate the
approval display. These controls do not connect to a running service. Arbitrary
corrections remain pending; the sketch has no general natural-language inference.

With the checkout's installed Playwright Chromium:

```sh
node docs/evaluation-design/review.mjs
```

Set `PLAYWRIGHT_BROWSERS_PATH` to your configured cache when needed (the cloud
checkout uses `/workspace/.cache/ms-playwright`). The review script reads both JSON
examples, checks unique/backward dependencies and bounds, then exercises all four
sketch states at the six #46 sizes. It verifies pending/revised approval behavior,
unknown corrections, exact-step approval scrolling and no service/network requests.
Screenshots go to `test-results/evaluation-design/`; inspect those rendered images.
This validates the proposal artifacts, not the proposed production contracts or
runner. The normal CI remains the unchanged application's regression gate.

Rendered review snapshots (synthetic design data):

- [Application suggestion](evaluation-design/previews/application.png)
- [ML suggestion on a phone](evaluation-design/previews/ml-mobile.png)
- [Exact-step review at 900×500](evaluation-design/previews/exact-steps-short.png)
- [Prerequisite failure on a phone](evaluation-design/previews/prerequisite-failure.png)

Local design review passed: JSON/example consistency and dependency/bound checks,
all four states across six viewport sizes, pending/unknown correction behavior,
revision approval separation and visible exact-step approval actions. Rendered
application/ML/fallback/failure and narrow/short exact-step captures were inspected.
Lint and `git diff --check` passed. No application source or runtime schema changed;
production suite contracts, execution and editor acceptance remain unverified until
phases B–E implement and test them.
