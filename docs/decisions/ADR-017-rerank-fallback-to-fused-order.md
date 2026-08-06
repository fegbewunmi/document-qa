# ADR-017: An Incomplete Reranker Response Discards the Entire Rerank, Not a Partial Merge

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

`rerank()` asks the model for a relevance score for every candidate in one batched call (ADR-015). Structured output guarantees shape, not completeness — the model could return scores for only some of the candidates, omitting others. Something has to happen for a candidate with no score.

## Options considered

**Option A: Treat a missing score as worst-case (relevance = 0)**
- Pros: Simple; every candidate gets a sortable value.
- Cons: Actively penalizes a candidate for a model omission, not for actual irrelevance — could bury a genuinely good chunk that hybrid retrieval correctly surfaced, purely because the reranker glitched on it. Reranking isn't a gatekeeper deciding whether to answer at all — that's synthesis's job (ADR-004's refusal threshold). It should only ever refine order among chunks retrieval already decided were worth showing, never silently discard one.

**Option B: Partial merge — scored candidates sorted by score, unscored candidates reinserted at their original fused position**
- Pros: Preserves as much of the reranking benefit as possible even when one candidate is missing a score.
- Cons: The merge logic itself (where exactly does an unscored candidate get reinserted relative to newly-reordered scored ones?) is not well-defined without more assumptions, adds real implementation complexity for what should be a rare case, and is harder to test exhaustively than a simple all-or-nothing rule.

**Option C: Discard the entire rerank attempt, fall back to the pre-rerank fused order (selected)**
- Pros: Simple, deterministic, easy to test and explain. Consistent with the precedent set by ADR-006 (an unrecoverable citation-validation failure fails to a clean, known-safe state rather than attempting a delicate partial fix). The pre-rerank order (hybrid fusion, already verified in ADR-011–013) is itself a fully valid, already-tested result — falling back to it is falling back to something already known to work, not degrading to nothing.
- Cons: A single missing score wastes the entire reranking benefit for that query, even though most candidates might have been scored correctly.

## Decision

If the reranker's response doesn't include a score for every candidate given to it, `rerank()` logs a warning and returns the original fused order (truncated to the requested count) unchanged — it does not attempt to partially apply the scores it did receive.

## Consequences

- Reranking can only ever match or improve on the pre-rerank order for a given query — never leave a chunk arbitrarily worse off due to a partial model failure.
- A query where the reranker partially fails silently loses the reranking benefit for that one request (falls back to hybrid-fusion-only quality) rather than surfacing an error — consistent with treating reranking as a best-effort refinement layer, not a required step the way retrieval and synthesis are.
