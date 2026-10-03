# Optional isolated workbench scenarios

This is the early fixture foundation for #46. It supports populated review while
#45, #47, #50, #63 and #66 are still in progress; it does not complete their
acceptance criteria or install data in the owner's running instance.

From a source checkout with the pinned Node 24/pnpm tools:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm demo:seed /absolute/path/to/new-paperloop-demo all
PAPERLOOP_DATA_DIR=/absolute/path/to/new-paperloop-demo/data pnpm start
```

The target directory's parent must exist. The loader atomically reserves a **new**
directory and refuses any existing path, including an empty directory or symlink.
It never falls back to the default/user data directory. It creates a private
connection credential using the normal service mechanism without printing it.
Use the normal browser launch to connect. Stop any other service on the selected
port, or select another `PAPERLOOP_PORT` before starting this isolated instance.
No live API provider or research fetch is used during seeding.

Choose `sparse`, `busy`, `measured`, or `all` as the last argument. `sparse` has an
empty project; `busy` has 24 synthetic papers/proposals, long context, saved and
dismissed decisions, a draft and an approved legacy Evaluation, pending/ready
experiments, and pending/paused/failed native schedule setup. `measured` adds the
seven measurement cases below; `all` also adds the sparse project. Project and
paper names are labeled Demo/Synthetic. Ready implementation progress and failed
schedule setup are simulations, not observations of a live agent or scheduler.
Native task references stay empty. Draft plans remain unapproved.

`manifest.json` records project/plan/paper/recommendation IDs and experiment/run
IDs, so a script or reviewer can select a reproducible scenario. Each seed gets
fresh IDs and actual timestamps; content, model inputs and expected outcomes are
deterministic. To reset, stop the instance and seed a different fresh directory.
There is deliberately no deletion or in-place overwrite/reset command. If loading
fails, retain the partial directory for inspection and retry at a new path.
These source-checkout developer scripts are not included in the release bundle.

## Real local measurements on synthetic data

The loader creates a standalone Git repository containing a tiny linear model,
a synthetic dataset, and a Node harness. It explicitly approves only its generated
fixture command and executes baseline/candidate runs in the application's normal
isolated workspaces. This is fixture authorization, not authorization of any user
Evaluation. The baseline predicts `y=x` for 300 cases with target `y=2x`.

| Candidate | Expected evidence |
| --- | --- |
| Weight 2, unchanged operations | Improvement; mean absolute error becomes zero |
| Weight 0.5 | Regression |
| Weight 1 | No meaningful change |
| Weight 2, doubled operations | Guardrail regression despite improved prediction error |
| Missing operations metric | Failed evidence validation; inconclusive comparison |
| Controlled thrown error | Failed candidate; inconclusive comparison |
| Controlled delay beyond the approved bound | Timed-out candidate; inconclusive comparison |

Both metrics have 300 actual samples. Operations is an instrumented model count,
not wall-clock latency or a performance claim. The `cases.json` report contains
300 inputs, expected/predicted values and calculated errors. The current runner
registers its copied report as `artifact-0`; retrieve it with
`GET /api/v1/runs/<runId>/artifacts/artifact-0`. Result/log artifacts, producer,
code identity, dataset/environment identity and fingerprints remain available
through the ordinary run detail. Failures and missing evidence are not filled
with fabricated scores. The synthetic papers make no claims about real research.

## Verification and responsive review

```sh
pnpm test:scenarios
pnpm test:browser tests/browser/scenarios.spec.ts
```

The Node check validates all seven outcomes, the 300-case artifact, draft approval
rejection, existing-directory refusal, and persisted comparisons/decisions/schedule
states after reopening the database. The browser fixture server calls the same
loader through a test-only endpoint; the production service has no seeding route.
The browser check rejects a recommendation, reloads and verifies persisted history,
reads measured case evidence through the authenticated API, navigates all five
sections, and exercises custom Evaluation focus/dismissal and scrolls the Save action into
view at every size. The shared browser server uses a simulated available OpenAI
provider and missing Anthropic provider with a stubbed executor; the standalone
loader uses a no-key environment. Neither path makes paid calls.

Captures and overflow assertions cover 360×844, 390×844, 768×900, 1024×768,
1440×1000, and an intermediate 900×500 short-height viewport. Images are saved
under `test-results/scenarios/` and retained by Linux/macOS CI. Inspect rendered
captures as well as test results. Passing assertions do not complete visual review.

Still to extend under #46: claimed/interrupted/cancelled lifecycle recovery, stale
research context, configured/observed native tasks and unavailable providers,
loading/failure/modal coverage, the complete Track journey, layered suites and
prerequisite skips from #66, and final cross-section visual/workflow acceptance.
Live Windows/WSL plugin and native scheduler evidence belongs to #63; this controlled
cloud fixture cannot establish installation or execution in the owner's client.

## Foundation review checkpoint (October 3, 2026)

Local build, typecheck, lint, 128 contract/server tests, both scenario checks,
30 browser workflows, and installed release smoke passed. The final narrow
scenario rerun additionally verifies visible Save actions at all six sizes.
Rendered captures for all five populated sections, custom Evaluation entry and
scrolled actions were inspected. No horizontal overflow or inaccessible modal
Save action was found in this matrix. This is the foundation review, not final
milestone acceptance. The existing build emits font-resolution and bundle-size
warnings; they are outside this fixture change and remain for cross-section review.

The next #66 phase is recorded in [the layered Evaluation design](EVALUATION_SUITES.md),
with conventional/ML examples and agent-led populated sketches. After that design
record, implement versioned contracts/storage in a dedicated bounded phase.
Keep #46 open for its remaining scenario and final live/visual/workflow coverage.
