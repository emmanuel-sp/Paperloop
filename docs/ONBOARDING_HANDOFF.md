# Guided onboarding checkpoint

This is the dedicated browser authentication phase of milestone 6 issue [#37](https://github.com/emmanuel-sp/Paperloop/issues/37), following the merged GitHub repository selection in [#53](https://github.com/emmanuel-sp/Paperloop/pull/53). The development grouping in [#34](https://github.com/emmanuel-sp/Paperloop/issues/34) and the operating policy proposed in [#49](https://github.com/emmanuel-sp/Paperloop/pull/49) keep authentication separate from repository inference. Issue #37 remains open until its other onboarding criteria are complete.

## Behavior and authentication review

- Normal built-app startup opens the workbench at the actual loopback host and port. A 256-bit random capability travels only through the local browser opener and URL fragment. The page removes it before rendering or API requests, then exchanges it once for the existing HttpOnly, SameSite=Strict session cookie. The persistent connection secret remains in its owner-only file.
- The capability is held in process memory, expires after 60 seconds, is bound to the exact launched origin, is invalidated by a replacement launch or shutdown, and is consumed synchronously to prevent concurrent replay. No production HTTP endpoint issues launch capabilities.
- The exchange requires an Origin header and still passes the global loopback Host and same-origin checks. The only new authentication exception is the capability exchange itself. Project/API/MCP credentials and explicit workbench evaluation/spending approval boundaries remain unchanged.
- React StrictMode does not repeat the exchange. Existing-tab fragment navigation reloads the document so it receives the same startup handling. Refresh retains the cookie without retaining the launch token in browser storage or the URL.
- Expired/replayed links show recovery instructions. Browser opener failure, headless operation, and `start --no-open` retain manual local connection. The development watcher uses `--no-open` to avoid opening a browser on every restart.
- macOS uses `open`, Linux uses `xdg-open`, and WSL uses Windows PowerShell with an encoded `Start-Process` command. No shell parses the URL, and opener output/errors are never printed. Real Windows browser/WSL forwarding remains a platform verification task; controlled unit checks cover dispatch and quoting.

## Evidence

Service checks cover expiry, replacement, origin/port binding, missing/wrong credentials, concurrent replay, session attributes, manual fallback, actual listening port, and shutdown/restart invalidation. Browser checks cover automatic connection, StrictMode, URL cleanup, inaccessible cookie/client storage, refresh, deep-link recovery, expired/replayed links, existing tabs, and desktop/mobile layouts. Installed-bundle smoke checks exercise the actual CLI with controlled platform opener shims, including success, `--no-open`, failure, persistence, and backup/restore. No paid calls are required.

Launch screenshots are saved under `test-results/browser-launch/` and retained by Linux/macOS CI as `browser-launch-<os>` artifacts. Inspect the populated Overview, connected Research, and expired-link desktop/mobile captures. The manual fallback was also inspected with agent-browser without an error overlay or JavaScript errors.

## Inferred onboarding phase

The remaining #37 flow now asks for name/repository first, then shows an editable context summary and compact objective/constraint/evaluation suggestions. Optional details let users correct the research direction and constraints. Errors retain the selected repository and corrections; missing context asks only for a short project summary. Suggestions require no provider key or model spending.

`POST /api/v1/projects/onboarding` uses bounded read-only inspection: at most seven fixed root filenames, 32 KiB each, plus a bounded Git revision query. Local document symlinks, non-regular and oversized files are rejected. GitHub files are fetched at a validated commit SHA when available, without cloning or following remote download URLs. Missing files/revisions return honest partial context. Private file access requires read-only Contents permission; repository Metadata alone still supports selection and a description fallback.

A maximum of 32 in-memory previews expire after 15 minutes or restart. Creation validates the preview's repository identity and rechecks GitHub access, then saves server-derived capture time, revision, hashes, uncertainty, suggested research direction/evaluation capabilities and user correction fields atomically alongside the initial context snapshot in the existing private app-state table. No migration is needed. Provenance remains in context history on later edits; neither a preview nor a detected test script approves an Evaluation or runs a command.

Local verification covers 109 service tests, the contract test, the 21 browser workflows, and installed release smoke. New workflow checks cover local/GitHub/description-only setup, invalid paths, loading, unavailable inspection, correction retention, revoked access before saving, refresh, and provenance. Populated desktop/mobile captures are under `test-results/onboarding/`, retained in CI as `onboarding-<os>`. Final issue completion requires the reviewed PR to merge after Linux/macOS CI passes.

## Next bounded unit

After #37 is verified and merged, continue #39's unified Research feed before #40's broad import, following #34's dependency order. The Research work should consume persisted inferred direction/context, retain triage, and keep execution/tracking status truthful. Draft Evaluation approval remains the separate #41 phase.

GitHub Project #2 is inaccessible to this integration (`Resource not accessible by integration`); issue dependencies and #34 provide the available queue. Current quota telemetry is unavailable, so the requested 10% personal usage reserve cannot be enforced automatically. This manually requested run takes one bounded phase and creates no development schedule.
