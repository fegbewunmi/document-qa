# ADR-016: Candidate Pool Widened for Reranking, Narrowed Back to Top-4 Afterward

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Before this change, `hybridRetrieve`'s `fusedK` defaulted to 4 — exactly the number of chunks synthesis consumes. If reranking were simply bolted onto the existing top-4, it could only ever reorder those same 4 candidates; it could never *promote* a chunk that hybrid fusion ranked 5th or lower but that is actually the best answer to the question. That would make reranking a much weaker feature — capable of fixing the order among 4 already-chosen chunks, but blind to a genuinely better chunk fusion left just outside the cut.

## Options considered

**Option A: Rerank only the existing top-4**
- Pros: No change to `hybridRetrieve`'s defaults; smaller/cheaper reranker call (4 candidates, not 10).
- Cons: Structurally can't fix the failure case that matters most — a relevant chunk that first-pass fusion ranked outside the top-4 never gets a chance to be promoted. This isn't the two-stage recall-then-precision architecture reranking is supposed to provide; it's just re-sorting an already-narrow set.

**Option B: Widen fusion's output, narrow after reranking (selected)**
- Pros: Matches the standard two-stage IR pattern — first-pass retrieval maximizes recall over a wider set cheaply (10 candidates), reranking maximizes precision by re-scoring that wider set with a more expensive method, then narrows to what synthesis actually sees (4). Gives reranking a real chance to correct fusion's mistakes, not just reorder around them.
- Cons: A larger reranker call (10 candidates instead of 4) — more tokens, more cost, more latency per query.

## Decision

`server/routes/query.ts` calls `hybridRetrieve(sources, { fusedK: 10 })`, then `rerank(question, candidates, rerankerModel, 4)` to narrow to the final 4 chunks passed to synthesis. `hybridRetrieve`'s own default (`DEFAULT_FUSED_RESULTS = 4`) is unchanged for any caller that doesn't rerank.

## Consequences

- Reranking can now promote a chunk fusion ranked as low as 10th into the final top-4 — the failure case reranking exists to fix.
- Every query now costs one full reranker call over 10 candidates, not 4 — a real latency/cost increase over hybrid retrieval alone, on top of the LLM call ADR-014 already accepted as a cost of choosing an LLM-based reranker.
- `10` is a round-number default, not tuned against the labeled eval set — consistent with how other untuned constants in this codebase (the ADR-004 refusal threshold, the RRF weights in ADR-011) are named explicitly as placeholders rather than presented as validated.
