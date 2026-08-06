# ADR-002: Centralized Database Config via DATABASE_URL

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

While restoring the missing `/upload` route (see ADR-001), the audit surfaced a second issue: `server/routes/query.ts` hardcoded its Postgres connection details (`host`, `port`, `user`, `password`, `database`) directly in the file, while `scripts/ingest.ts` read `DATABASE_URL` from `.env`. The two would silently diverge the moment someone changed their `.env` — `ingest.ts` would pick up the new connection, `query.ts` would keep connecting to the old hardcoded target. The new `/upload` route needed its own database config too, which would have introduced a third, independent copy of the same information.

## Options considered

**Option A: Leave `query.ts` as-is; give `upload.ts` its own config**
- Pros: Zero risk to already-working code.
- Cons: Perpetuates the drift risk and adds a third copy instead of fixing the underlying problem.

**Option B: Centralize into a shared module (selected)**
- Pros: One source of truth for connection config and the `documents` table name; `query.ts` and `upload.ts` both import from it; eliminates the drift class of bug entirely for the Express server.
- Cons: None significant — this is a small, mechanical extraction with no behavior change (the resolved connection details are identical to what `query.ts` had hardcoded, since the README's documented `DATABASE_URL` matches those hardcoded defaults).

## Decision

Added `server/db.ts`, exporting `dbConfig` (built from `process.env.DATABASE_URL`) and a `DOCUMENTS_TABLE` constant. `server/routes/query.ts` and `server/routes/upload.ts` both import from it instead of hardcoding or re-deriving connection details.

`scripts/ingest.ts` was left untouched — it is a separate, standalone Node entry point (not routed through Express), and duplicating a two-line `dotenv.config()` + `DATABASE_URL` read there is not the same class of risk as three independently-hardcoded copies inside the server.

## Consequences

- `query.ts`'s runtime behavior is unchanged today (the resolved connection details are identical), but it is no longer silently incorrect if `.env` changes.
- Any future Express route needing database access has an obvious shared import rather than a third copy to keep in sync.
- `scripts/ingest.ts` still reads `DATABASE_URL` independently — acceptable, but worth revisiting if the CLI script grows more database-touching logic.
