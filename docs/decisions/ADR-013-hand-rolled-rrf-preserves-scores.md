# ADR-013: RRF Implemented Directly Instead of Calling EnsembleRetriever

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

`langchain`'s `EnsembleRetriever` implements the exact RRF formula chosen in ADR-011 and is already installed. Using it directly was the first instinct — reuse a vetted library implementation rather than hand-roll the fusion math. But `EnsembleRetriever` dedupes results by exact `pageContent` string match and returns bare `Document` objects with no numeric score attached — RRF is rank-based internally, and the fused score is used only to sort, never exposed on the output.

Two things in the already-built pipeline depend on every chunk having a real, individual cosine-distance score:
1. The frontend's "% match" display (fixed earlier this session — `src/lib/matchPercent.ts`).
2. The similarity-threshold refusal guard (ADR-004) in `server/lib/synthesize.ts`, which reads `chunks[].score` to decide whether to skip the LLM call entirely.

Calling `EnsembleRetriever` directly would silently break both — there would be no per-chunk score left to display or threshold against.

## Options considered

**Option A: Call `EnsembleRetriever` directly**
- Pros: Zero custom fusion code — the library does all of it.
- Cons: Loses per-chunk vector distance for every result, breaking the score display and the refusal guard without any error or warning — a silent regression in already-verified, already-documented behavior.

**Option B: Hand-roll RRF using the same formula, on a richer internal representation (selected)**
- Pros: Uses the identical, literature-established formula and constant (`weight / (rank + c)`, `c = 60`) that `EnsembleRetriever` uses — not a from-scratch invention, just not routed through the library's Document-only interface. Retains a real cosine distance for every fused chunk: chunks already in the vector search's own results keep their real distance; chunks that entered the candidate set only via keyword search get a real distance computed for them too (a small follow-up query against just those IDs), rather than a fabricated placeholder score.
- Cons: More code than calling the library function directly — a small `reciprocalRankFusion()` utility plus the follow-up distance lookup.

## Decision

`server/lib/hybridRetrieve.ts` implements `reciprocalRankFusion()` directly, matching `EnsembleRetriever`'s formula, operating on `{id, text, metadata, distance?}` rows keyed by the `documents` table's UUID `id` column (not `pageContent` text matching). After fusion selects the top-K IDs, any ID that only came from keyword search (no vector distance yet) gets a real distance computed via a small batched query, so **every** chunk reaching the frontend and the refusal guard has a genuine cosine distance — never a sentinel or fabricated value.

## Consequences

- ADR-004's refusal guard and the frontend's score display both continue working unchanged — hybrid retrieval is additive to the existing pipeline, not a breaking change to it.
- Fusion is keyed by the table's real UUID `id`, which is more robust than `EnsembleRetriever`'s own text-equality dedup (immune to any whitespace/formatting difference between how the two retrieval paths might otherwise represent the "same" chunk).
- One additional small query (`vectorDistanceForIds`) is needed only when the fused top-K includes a keyword-only match — most queries incur no extra cost beyond the two searches already required.
