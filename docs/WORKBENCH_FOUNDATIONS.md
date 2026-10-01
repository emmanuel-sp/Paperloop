# Workbench foundations

The workbench follows one journey: connect a project, discover relevant research,
start a contextual experiment, and inspect evidence. The five project destinations
are Overview, Research, Experiments, Schedules, and Settings. Product decisions and
inference/approval boundaries live in [PRODUCT_SCOPE](../PRODUCT_SCOPE.md#8-ui-and-daily-workflow)
and [TECHNICAL_DESIGN](../TECHNICAL_DESIGN.md#http-api-and-workbench).

## Visual language

The [COMPUTE reference](https://v0-compute-11.vercel.app/#how-it-works)
informs the dark canvas, generous negative space, and large, light typography.
Paperloop applies those choices to an operational research workspace. It shows
real requests, agent handoffs, and measured evidence rather than simulated chat.

Use the reference's Instrument Sans (regular 400) for body and display type and
JetBrains Mono for compact utility labels. Both variable fonts are bundled locally,
so opening Paperloop does not contact a font service. Canvas `#030303`, surface
`#080808`, raised surface `#111111`, foreground `#e9e8e5`, muted text `#9d9b95`,
and white primary controls define the monochrome palette. Pink is reserved for
focus and small connection cues. The semantic tokens in `styles/foundation.css`
own the palette, spacing, and focus states. Display headings scale to 100–108px
on desktop; body text uses 16px and a 1.6 line height. Regular weight, generous
spacing, and muted second lines establish hierarchy. Utility text uses the mono
face. Color always pairs with a written status.

The horizontal navigation and separate project context row frame the workspace.
Quiet outlined panels organize research and evidence. Native dialogs and the
mission composer use rounded corners; information panels remain nearly square.
The original fiber-loop illustration in `public/images/research-loop.png` gives
Overview the reference's organic visual character without copying its artwork.
Its empty alternative text keeps this decorative asset out of the reading order.

The research mission composer is the primary interaction. Its editor grows with
content, shrinks when cleared, and scrolls for long drafts. Browser resize handles
are disabled throughout. A compound focus ring identifies the composer. Sources,
URL extraction, import, experiment preparation, schedule creation/editing, paid
analysis, automation rules, and evaluation creation use focused dialogs. Keep
one prominent action per task. Technical provenance and advanced overrides can
remain secondary disclosures; primary creation forms are not accordions.

The five section compositions are intentionally different. Avoid gradients, excessive pills, and repeated administration
layouts. Use outlines to group information; do not add unrelated decorative rules. Native controls use the dark color scheme and explicit
foreground/background tokens. Reduced-motion preferences suppress transitions.

## Specific section treatments

| Section | Foundation treatment | Review evidence |
| --- | --- | --- |
| Overview | Large research/build/measure typography beside the fiber-loop illustration, three workflow entry panels, actual activity counts, next-step rows, and quiet project context. Activity loading/failure uses the shared state pattern. | `overview-desktop.png`, `overview-mobile.png` |
| Research | Discovery opens with a mission composer and an honest search → agent assessment → evaluation sequence. Detail appears when a paper is selected. A compact action row separates primary research views from tertiary source/import dialogs. Recommendation applicability, source claims, and selected paper detail have distinct hierarchy. Sources and import load/save errors retain useful next actions. | `research-desktop.png`, `research-mobile.png`, `sources-dialog-*.png` |
| Experiments | Paper details open contextual experiment preparation with the paper selected. A work-history column sits beside progress and measured evidence; creation is absent from the viewing tab. Evaluation opens in a secondary dialog without losing the selected experiment. Comparison headings and tables are readable; unavailable/loading experiment details have explicit states. | `experiments-desktop.png`, `experiments-mobile.png`, `evaluation-dialog-*.png` |
| Schedules | Prominent cadence/time cards sit alongside observed work. Creation/editing use dialogs and removal requires confirmation. Written state, setup report, intended timing, and actual check-ins are distinct. Focused action groups and a separate Recent work section prevent intended scheduling from implying observed execution. | `schedules-desktop.png`, `schedules-mobile.png` |
| Settings | A large centered connection headline, separate connection and paid-analysis surfaces, written disabled-paid state, and focused optional configuration dialogs. Connection guidance remains secondary to research. Missing activations never imply missing keys or verified client setup. | `settings-desktop.png`, `settings-mobile.png` |

These are interaction and layout foundations. The milestone's subsequent issues
own minimal onboarding and connected repository selection (6.3/6.4), unified
Research and broad import (6.5/6.6), suggested Evaluation and contextual experiment
recommendation-driven preparation (6.7/6.8), inherited schedule preferences (6.9/6.10), richer
Overview guidance (6.11), detailed comparisons (6.13), and the production demo and
complete workflow review (6.12). Existing controls remain usable during this
incremental migration; these foundations do not claim to finish those flows.

## Shared components

- `components/Dialog.tsx`: native modal dialog, labeled title/description, inert
  background and contained focus, focus return, Escape and deliberate backdrop
  dismissal, and optional dismissal protection while saving. The dialog scrolls
  internally and uses a compact layout at narrow widths.
- `components/AutoTextarea.tsx`: native textarea props and content sizing, a bounded
  scrolling editor, width-change observation, paste support, and no resize handle.
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
populated sections, the primary discovery composer, source/Evaluation dialogs, and loading/empty/error captures.
CI uploads the `workbench-foundations-<os>` artifacts on Linux and macOS so a PR
reviewer can inspect successful runs as well as failures. The eleven browser regressions
also exercise content growth/shrink, width changes, contextual research entry,
schedule editing/removal, preserved library filters, missing approval guidance,
nested Evaluation focus, and Tab/Shift+Tab containment, focus restoration, Escape/backdrop
closure, required-field validation, input retention after a controlled failed save,
blocked dismissal while saving, successful import, retry recovery, legacy links,
and a paid-call-free Python comparison. Page-width checks at 320, 390, and 1024 pixels catch horizontal
spillover; wide result tables scroll within their own container.
