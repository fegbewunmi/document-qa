# ADR-001: Upload Replaces the Indexed Document (Not Accumulate)

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

The audit of the existing codebase found that `server/index.ts` imported `./routes/upload`, but that file did not exist anywhere in the repository — the server crashed on startup. `multer` and `pdf-parse` were present in `package.json` as dependencies but used nowhere, confirming the route had been planned but never written.

Implementing the missing route required deciding what happens to previously indexed content on a new upload. The frontend (`src/App.tsx`) already displayed "Replace PDF" as the button label once a document was active, implying a single-active-document model. But the existing ingestion path (`scripts/ingest.ts`, a standalone CLI script) appends chunks to a shared `documents` table with no document identifier column, and `server/routes/query.ts` has no filter by source — so two prior ingests would silently blend into one search space.

## Options considered

**Option A: Accumulate, no scoping (matches existing CLI script behavior)**
- Pros: No schema change; identical behavior to `scripts/ingest.ts`, so the two ingestion paths stay consistent with each other.
- Cons: Contradicts the UI's own "Replace PDF" copy. A second upload would silently blend into the first document's search space, which is confusing and wrong for a single-document Q&A app.

**Option B: Accumulate, but scope queries by document ID**
- Pros: Correct model for eventual multi-document support.
- Cons: Requires a schema change (a `documentId`/`source` column used in query filtering), touching `ingest.ts`, `query.ts`, and the table schema. Meaningfully larger than "add the missing route" — the audit's actual scope.

**Option C: Replace (selected)**
- Pros: Matches the UI's existing "Replace PDF" copy exactly. Keeps `/query` results scoped to the one document that's actually active, with no schema change.
- Cons: The CLI script (`scripts/ingest.ts`) is untouched and remains append-only, so a workflow that mixes CLI ingestion and web upload could behave inconsistently. Documented here rather than silently left as a surprise.

## Decision

`POST /upload` truncates the `documents` table before embedding and storing the newly uploaded PDF. Truncation tolerates the table not existing yet (Postgres error code `42P01`, undefined_table) for the very first upload.

## Consequences

- The web upload flow now matches what the UI has always told the user would happen.
- `scripts/ingest.ts` remains append-only and is a known, documented inconsistency between the two ingestion entry points — acceptable for now since the CLI script is a manual, occasional-use tool, not part of the primary app flow.
- Multi-document support, if ever needed, requires revisiting this decision in favor of Option B (schema-level document scoping).
