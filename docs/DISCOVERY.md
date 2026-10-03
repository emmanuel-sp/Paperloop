# Research discovery and triage

Open **Sources** in a project's **Research** page to adjust compact suggestions, collection choices, or individual overrides; RSS/Atom is secondary. Projects without a saved selection receive a context-matched collection, or arXiv AI/ML metadata sources as a fallback. Suggestions are labeled and do not fetch anything until Track. Saved choices, including deliberately empty selections, take precedence. Collections are data in `apps/server/src/research/source-catalog.ts`; adding another topic does not change scan orchestration. Projects retain independent saved selections. Track explicitly opts into suggestions when no selection is saved. Scheduled scans continue to use saved sources; suggestions do not silently alter existing schedules.

In **Research**, agent proposals and discovery share one page. The discovery composer suggests an angle from saved onboarding direction, then the first project objective or description. Correct it inline and use **Track** to collect from selected sources once. Corrections stay in the page URL through refresh and source configuration; submitted angles are also retained in scan history. Track does not register ongoing monitoring or start an agent. Each scan persists its query, document IDs, per-source outcome, coverage, retry time, and next offset. Use **Next page** for additional results. One failed source does not erase successful results from another. The **Saved research** dialog searches indexed titles, authors, and extracted text; enable **Search across all projects** to reuse a document in the current project. **Import paper** accepts references and text already available to a user or agent. A public article URL can also be fetched directly.

## Coverage and limits

- arXiv supports historical and recent metadata searches, using its [Atom query API](https://info.arxiv.org/help/api/user-manual.html). Each request retrieves at most 25 results per source; pagination is capped at offset 10,000. Paper URLs, modern/legacy identifiers, and version suffixes share one canonical identity. arXiv calls are spaced by at least three seconds; server rate limits and `Retry-After` survive restart.
- Feeds cover the first 200 available entries, previously indexed articles, and directly submitted URLs. They do not provide a complete historical web index. Feed queries match titles and summaries locally and return a bounded page from that feed snapshot; a feed may change between requests. Direct URLs can add articles absent from the feed.
- HTTP(S) downloads are limited to 20 seconds, 10 MiB, four redirects, and standard ports. DNS answers and redirect destinations must remain public; local/private addresses and credentials in URLs are rejected. Fetched content is data and cannot authorize commands or launch agents.
- HTML extraction uses [Mozilla Readability](https://github.com/mozilla/readability) in a DOM without script or subresource execution. Text PDFs use [PDF.js](https://mozilla.github.io/pdf.js/examples/), with at most 200 pages and five million characters. Plain text is supported. Scanned PDFs have no OCR fallback. Unsupported, empty, partial, and failed extraction remain visible; feed summaries are partial evidence until full text is fetched.
- SQLite FTS5 indexes the current document text. Searches return at most 100 metadata records, with `nextOffset`. Content retrieval returns at most 20,000 characters per call. The workbench pages through text rather than expanding the entire document.

## Durable library and provenance

One shared document identity is separate from project membership, briefs, recommendations, and triage. Metadata-only discovery cannot replace a complete extraction of the same version. Older arXiv versions do not roll the current document backward, and retained version content remains available by version ID. Known authors survive sources that omit author metadata. Tracking fragments and common tracking parameters do not create duplicate URL documents; arbitrary query parameters remain meaningful.

The schema-v5 migration creates the search index, preserves existing documents and extracted files, backfills old content, and records a recoverable pre-upgrade database backup. Original text files remain local artifacts; FTS holds the searchable copy. `GET /api/v1/projects/:id/research/:documentId/versions` lists the latest 100 retained snapshots. Read a snapshot by passing `versionId` to the normal content endpoint or MCP content tool. Documents are not automatically downloaded merely because a feed or arXiv search returned them; full-text extraction is explicit.

## Agent analysis and triage

Search and extraction need no model API key. Collected documents persist while waiting for a coding agent. Paperloop does not start another executor or silently fall back to a paid provider. Through MCP, an agent reads `research_pending_analysis`, the current project context, and bounded source text, then submits `research_store_recommendation`.

Every recommendation requires a primary document, applicability, prerequisites (which may be an empty list), uncertainty, at least one evaluation target, and source claims with evidence. Source documents must belong to the project and the context version must be current. The service captures cited document versions; an explicitly stale source version is rejected. Supporting research claims remain distinct from measured project results.

The feed shows undecided recommendations for current project context, ranked across the full result set before pagination by bounded text overlap with the angle and project goals. Matched terms are displayed; this lexical ordering is not a model relevance score or measured benefit. Applicability and concise cited evidence remain visible. **Accept & prepare** saves the existing `saved` triage state before opening contextual experiment preparation; **Reject** saves `dismissed`. Preparation still requires exact Evaluation approval and starts no work automatically. Optional decision notes survive failed saves.

**Past decisions & context** retains accepted, rejected, tested, and older-context items. Current accepted items can continue preparation; rejected items can be deliberately reconsidered. Stale-context items ask for agent reassessment and offer no preparation shortcut. Agent resubmission/rescans preserve triage, so decided items do not return to new findings. Linked tested experiments expose their evidence. Recent collected-paper previews open source detail while waiting for agent assessment.


Recommendations have one stable identity per project/document. Agent resubmission increments the proposal revision and preserves the user's **new**, **saved**, **dismissed**, or **tested** state and reason. Every triage change appends a history entry. Dismissed and tested material is not repeatedly requeued as new by scans. **Mark tested** can be a manual decision; an optional experiment ID must reference a completed experiment for that same project and document. The decision alone does not assert a measured benefit.

## Shared API and MCP operations

| Operation | HTTP | MCP |
| --- | --- | --- |
| Inspect sources | `GET /api/v1/research/sources` | `research_sources` |
| Read/save project selections | `GET/PUT /api/v1/projects/:id/sources` | `research_project_sources`, `research_select_sources` |
| Scan sources | `POST /api/v1/projects/:id/discovery/search` | `research_search` |
| Read recent scans | `GET /api/v1/projects/:id/discovery/scans` | `research_scans` |
| Search reusable library | `GET /api/v1/research/library` | `research_library_search` |
| Search project library | `GET /api/v1/projects/:id/research/search` | `research_library_search` with `projectId` |
| Attach shared document | `POST /api/v1/projects/:id/research/:documentId/attach` | `research_attach` |
| Fetch URL / extract document | `POST …/research/fetch`, `POST …/research/:documentId/extract` | `research_fetch_url`, `research_extract` |
| Inspect versions / read text | `GET …/research/:documentId/versions`, `GET …/research/:documentId/content` | `research_versions`, `research_read_content` |
| Pending analysis | `GET …/research/pending-analysis` | `research_pending_analysis` |
| List/save recommendations | `GET/POST …/recommendations` (GET accepts `view=all|actionable|history`, `query`, `offset`, `limit`) | `research_recommendations`, `research_store_recommendation` |
| Triage / inspect history | `PATCH …/recommendations/:recommendationId`, `GET …/recommendations/:recommendationId/history` | `research_triage`, `research_triage_history` |

All operations use the existing local connection credential. Scan history is bounded to the latest 50 scans; triage history to 100 entries; the legacy research list to the latest 100 documents. Library, recommendation, and pending-analysis requests accept bounded `offset`/`limit` pages. Query schemas and public types live in `packages/contracts/src/discovery.ts`; feature services and transport adapters are under server `research/` and `mcp/`, with workbench components under web `research/`.

## Verification

Regression tests cover RSS and Atom parsing, arXiv pagination, cross-source deduplication, independent project selections, persisted source cooldowns, source failures, version retention, full-text retrieval, migration from schema v4, HTML/plain-text/text-PDF extraction, scanned/mixed PDF outcomes, private DNS and redirects, response size limits, invalid/stale recommendations, triage across rescans/restart, a real authenticated MCP client, and triage linked to an actual completed Python experiment.

Production-workbench browser verification uses temporary data and deterministic source fixtures, covering collection selection, source scan, dismissal preservation, restart persistence, local full-text search, explicit extraction, text pagination, and layout/runtime-error checks. This does not claim every third-party source is available at all times; individual source failures are reported by the scan.

A live read-only adapter smoke check also retrieved two results and a next-page offset from both the configured Hugging Face feed and arXiv.
