# ADR-012: Postgres Full-Text Search for the Keyword Retrieval Signal

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Hybrid retrieval (ADR-011) needs a keyword/exact-match retrieval signal alongside vector search. Two realistic options exist within the current stack.

## Options considered

**Option A: `langchain`'s `BM25Retriever` (selected: rejected)**
- Pros: Already available in the installed `langchain` package; standard BM25 ranking algorithm.
- Cons: In-memory — takes a static `docs: Document[]` array at construction and ranks entirely in application memory, not the database. Requires adding a new dependency (`okapibm25`, not currently installed). Moves keyword ranking logic out of Postgres for no benefit at the current corpus size, and doesn't scale the way a DB-side query does if the corpus grows.

**Option B: Postgres full-text search — `tsvector`/`ts_rank` (selected)**
- Pros: No new dependency. Queries the same `documents` table and `text` column the vector search already uses — keeps everything colocated in Postgres, the same reasoning that justified pgvector over a dedicated vector database in the first place (see `docs/ARCHITECTURE-RATIONALE.md`, #1). Scales via a standard GIN index rather than loading the full corpus into application memory on every query.
- Cons: Basic English-language stemming/tokenization (`to_tsvector('english', ...)`) — no custom synonym handling or domain-specific tuning. Sufficient for exact identifiers (error codes, SKUs) and common-word matching, which is the motivating case here.

## Decision

The keyword side of hybrid retrieval runs `to_tsvector('english', text) @@ plainto_tsquery('english', $question)`, ranked by `ts_rank`, against the same `documents` table. A `GIN` index on `to_tsvector('english', text)` is created (idempotently, `IF NOT EXISTS`) after each successful upload, alongside the existing truncate-and-replace step (ADR-001).

## Consequences

- No new runtime dependency.
- Keyword matching quality is bounded by Postgres's built-in English text search — adequate for exact identifiers and common terms, not a substitute for a dedicated search engine (e.g. Elasticsearch) if query patterns ever demand fuzzy matching, typo tolerance, or non-English support.
- The GIN index is created once per upload, not per query — keeps query-time full-text search fast without repeated `CREATE INDEX IF NOT EXISTS` overhead on every request.
