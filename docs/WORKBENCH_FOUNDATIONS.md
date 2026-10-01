# Workbench foundations

The workbench follows one journey: connect a project, discover relevant research,
start a contextual experiment, and inspect evidence. The five project destinations
are Overview, Research, Experiments, Schedules, and Settings. Product decisions and
inference/approval boundaries live in [PRODUCT_SCOPE](../PRODUCT_SCOPE.md#8-ui-and-daily-workflow)
and [TECHNICAL_DESIGN](../TECHNICAL_DESIGN.md#http-api-and-workbench).

## Visual language

Use the system sans-serif stack, a warm neutral canvas, white surfaces, quiet
indigo actions, and soft shadows. Main headings scale from 28 to 36px, section
headings use 19px, and body copy uses 15px with generous line spacing. Use the
shared 8/16/24/32px spacing tokens to separate related controls, cards, and
sections. Align readable text to the left and keep long context summaries within
65 characters per line. Color reinforces written status; it never replaces it.

Use one prominent action per task. Secondary actions use quiet surfaces; tertiary
import, source, and Evaluation actions use text treatment. Avoid gradients,
decorative rules, excessive pills, and ornamental borders. Borders identify form
controls; shadows and whitespace organize surfaces. Keep exact identifiers,
command details, source overrides, feeds, and automation configuration in optional
details. Preserve deliberate approval even when suggestions reduce field burden.

## Specific section treatments

| Section | Foundation treatment | Review evidence |
| --- | --- | --- |
| Overview | Quiet activity counts, readable context, distinct next-step rows, and secondary provenance. Activity loading/failure uses the shared state pattern. | `overview-desktop.png`, `overview-mobile.png` |
| Research | Discovery opens by default. A compact action row separates primary research views from tertiary source/import dialogs. Recommendation applicability, source claims, and selected paper detail have distinct hierarchy. Sources and import load/save errors retain useful next actions. | `research-desktop.png`, `research-mobile.png`, `sources-dialog-*.png` |
| Experiments | A work-history column sits beside progress and measured evidence. Evaluation opens in a secondary dialog without losing the selected experiment. Comparison headings and tables are readable; unavailable/loading experiment details have explicit states. | `experiments-desktop.png`, `experiments-mobile.png`, `evaluation-dialog-*.png` |
| Schedules | Cadence, written state, setup report, intended timing, and actual check-ins are distinct. Focused action groups and a separate Recent work section prevent intended scheduling from implying observed execution. | `schedules-desktop.png`, `schedules-mobile.png` |
| Settings | Separate connection and paid-analysis surfaces, written disabled-paid state, and optional automation bounds. Connection guidance remains secondary to research. Missing activations never imply missing keys or verified client setup. | `settings-desktop.png`, `settings-mobile.png` |

These are interaction and layout foundations. The milestone's subsequent issues
own minimal onboarding and connected repository selection (6.3/6.4), unified
Research and broad import (6.5/6.6), suggested Evaluation and contextual experiment
creation (6.7/6.8), schedule modals and inherited preferences (6.9/6.10), richer
Overview guidance (6.11), detailed comparisons (6.13), and the production demo and
complete workflow review (6.12). Existing controls remain usable during this
incremental migration; these foundations do not claim to finish those flows.

## Shared components

- `components/Dialog.tsx`: native modal dialog, labeled title/description, inert
  background and contained focus, focus return, Escape and deliberate backdrop
  dismissal, and optional dismissal protection while saving. The dialog scrolls
  internally and uses a compact layout at narrow widths.
- `components/Field.tsx`: associated control label, help text, and local error
  attributes, shared by single-line, multiline, and selection controls.
- `components/SectionHeading.tsx`: section purpose and optional focused action.
- `components/AsyncState.tsx`: empty, loading, recoverable error, and waiting
  messages. Announce state changes and mark loading busy; give errors an explicit
  retry action when available.
- `components/WorkflowStatus.tsx`: written execution and outcome labels that
  remain understandable without color.

Keep feature logic within its feature directory. The components provide semantics
and composition rather than fetching project data. Styling lives in the existing
`styles` directory; `dialog.css` owns the modal layout. Editable code is under
`apps/web/src`; `dist`, `node_modules`, and `test-results` are generated output.

## Reproduce and review

Use Node 24.15 or newer within Node 24 and pnpm 10.18.3:

```bash
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
```

The populated-example browser test also runs independently:

```bash
pnpm test:browser --grep 'populated section'
```

The test-only server creates a temporary SQLite store and Git repository. Its
synthetic paper is a UI fixture, not a real publication. Baseline/candidate values
come from tiny real Python subprocesses in isolated workspaces. Native schedules
remain paused or setup-pending; paid analysis is disabled. No model call is used.
Fixtures do not modify the user's Paperloop data or the local demo project.

Review `test-results/foundations/` at 1440×1000 and 390×844. It includes all five
populated sections, source/Evaluation dialogs, and loading/empty/error captures.
CI uploads the `workbench-foundations-<os>` artifacts on Linux and macOS so a PR
reviewer can inspect successful runs as well as failures. The browser regressions
also exercise Tab/Shift+Tab containment, focus restoration, Escape/backdrop
closure, required-field validation, input retention after a controlled failed save,
blocked dismissal while saving, successful import, retry recovery, legacy links,
and a paid-call-free Python comparison. Page-width checks catch horizontal
spillover; wide result tables scroll within their own container.
