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


## Phase 3: source defaults, relevance and decisions

Branch `codex/research-feed-triage`, based on merged #57. Unconfigured projects expose labeled context-matched source suggestions; saved selections, including empty choices, win. Track explicitly opts into suggestions through `useSuggestedSources`; scheduled/legacy scans default to saved selections. No source read starts fetching. RSS and individual overrides remain secondary.

The recommendation API/MCP accepts `view=all|actionable|history` and ranks the complete set before pagination using bounded lexical overlap with angle/context goals. Responses expose matched terms and current-context status. New findings exclude accepted/rejected/tested and stale-context items; past decisions retain them. Accept saves existing `saved` triage before contextual preparation, Reject stores `dismissed`. Stale ideas ask for reassessment; exact Evaluation approval still governs preparation. Notes are optional and failures retain them. Collected-paper previews open evidence in the same Research page.

Verification covers global ranking/pagination, all durable states through resubmission and restart, context changes, default source opt-in and explicit empty selections, real browser acceptance/rejection and approval-required preparation, failed decision notes, and populated desktop/mobile decision history. Persistent monitoring remains #50; automatic Evaluation remains #41. Continue #40 after #39 acceptance and CI are complete. Quota telemetry remains unavailable; no reserve reading is claimed.


Phase 3 local validation: build, typecheck, lint, 113 contract/server tests, and all 24 browser tests passed. The final narrow-screen acceptance/rejection rerun also passed. Populated 1440px/390px ranked-feed and decision-history captures were inspected; CI retains them under the foundations artifacts. Review Linux/macOS CI and release smoke on the published current head before merging. With all three phases merged, #39 is ready to close and #40 is the next dependency-ready Research unit.

## Broad import

Import paper accepts a URL, arXiv identifier (including explicit versions), DOI, citation, pasted text, or a PDF/plain-text upload up to 1 MiB. Preview resolves public metadata and text without creating a library record. Review extraction availability, duplicate identity, and uncertainty before saving; optional corrections and pasted fallback text stay secondary. DOI metadata uses Crossref; arXiv uses public metadata plus bounded full-text extraction. No model or paid API is called.

Preview tokens are project-scoped, retained for 15 minutes, and bounded to 32 outstanding previews. Service restart requires another preview. Saving uses canonical library deduplication and retains import notes with the project’s paper. Unsupported files and source failures are shown honestly rather than treated as successfully extracted research.
