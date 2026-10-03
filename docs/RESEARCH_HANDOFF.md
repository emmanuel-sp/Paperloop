# Unified Research checkpoint

Issue #39, phase 1, branch `codex/unified-research-foundation`.

Research now shows agent proposals above discovery on one page, without sub-tabs. Saved research uses a focused dialog alongside Sources and Import. Selecting or importing a paper closes the secondary view and retains its URL selection. Saved filters and legacy library/recommendation URLs remain usable. Document searches run only when the saved-research dialog opens.

Validation: build, typecheck, lint, 111 contract/service tests, and all 21 browser tests passed. After the final proposal-first ordering and conditional saved-panel mount, the build/lint and five affected browser tests passed again. Populated desktop (1440px) and narrow (390px) screenshots were inspected; existing layout checks also cover 320px. Screenshots are generated under `test-results/foundations/research-{desktop,mobile}.png` and retained by CI. No new model calls, evaluations, or authentication changes.

Issue #39 remains open. This phase establishes composition, not all feed acceptance criteria. Next: infer/correct the research angle from persisted context; Track with truthful one-off status; compact source defaults; relevance ordering and concise evidence; durable accept/reject with contextual preparation; verify repeated discovery and failure/no-agent states. Existing Save/Dismiss/Reopen behavior is unchanged. #50 owns persistent monitoring, #41 owns automatic Evaluation drafts and execution approval. Continue #39 before #40 broad import.

The operating policy is currently proposed in PR #49, not present on main. Current quota telemetry was unavailable, so the 10% reserve could not be enforced. Work was kept to this bounded composition phase. Review Linux/macOS CI on the PR before merging; do not close #39 for this partial phase.


## Phase 2: inferred angle and Track intent

Branch `codex/research-angle-track`, based on merged phase 1 (#56). Discovery now prefers the current context’s saved onboarding research direction, then the first nonempty project objective, then description, bounded to 500 characters. The angle is directly editable; corrections stay in the Research URL through refresh and source-dialog navigation. Submitted angles remain in existing durable scan history.

Track performs one collection request through the existing discovery API. The UI explicitly says that this action does not configure ongoing monitoring; collection progress and waiting-for-agent states remain separate. Blank angles, missing sources and concurrent submits are disabled/guarded. Source defaults, ranking/evidence, and durable accept/reject are still pending in #39. #50 retains ongoing monitoring; #41 retains suggested Evaluation and exact approval. No paid model calls or evaluation execution were added.

Validation: build, typecheck, lint and all 23 browser tests passed; new coverage checks objective/inference/description fallback, correction retention through reload and Sources, controlled discovery failure/retry, blank angles and mobile layout. The final submit guard is verified by the focused inference/progress rerun. Populated desktop/mobile `track-{desktop,mobile}.png` captures were inspected locally and are included in CI’s foundations artifacts. Full service/contract and release smoke verification runs in Linux/macOS CI. Review current CI before merging. Keep #39 open and continue compact source defaults and recommendation ranking/triage before #40.

Quota telemetry remains unavailable, so the personal reserve cannot be automatically enforced. This turn remains one bounded phase.
