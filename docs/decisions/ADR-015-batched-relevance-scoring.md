# ADR-015: Per-Candidate Batched Relevance Scoring, Not Direct Reordering

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Once an LLM reranks candidates (ADR-014), it needs an output format. The judge could score each candidate independently, or could be asked to directly output a full reordering of the candidate list.

## Options considered

**Option A: Direct full reordering**
- Pros: Simpler schema — one array of reordered candidate indices.
- Cons: Harder to validate correctness of. Checking "is this a valid permutation of 1..N" is checkable, but doesn't confirm "is this actually the right order" — a valid-looking permutation could still silently drop the model's actual reasoning about *why* one candidate beat another. Doesn't decompose into an interpretable per-item signal.

**Option B: Per-candidate relevance score, batched (selected)**
- Pros: Mirrors the faithfulness judge's per-claim verdict pattern (ADR-007, ADR-008) — the same reasoning applies: independent per-item judgments in one batched call are more reliable and more debuggable than asking a model to reason about a whole list holistically at once. A missing or invalid score for one candidate is a well-defined, individually-checkable failure (see ADR-017), rather than an ambiguous "is this permutation wrong, or just different" problem.
- Cons: Doesn't optimize the model's few-shot reasoning over pairwise or listwise comparisons the way some published reranking-prompt techniques do — a possible quality gap against more sophisticated LLM-reranking prompt designs, accepted for consistency with the rest of the codebase's per-item judgment pattern.

## Decision

`server/lib/rerank.ts` asks the model for one structured-output call returning `{ scores: [{ candidateIndex, relevance }] }` — a 0–10 relevance score per candidate, given the full candidate set in one prompt. Candidates are then sorted by score, descending.

## Consequences

- Consistent scoring interface across the codebase: `synthesizeAnswer` validates `citedChunkIndices` (ADR-006), `checkFaithfulness` validates per-claim verdicts (ADR-007/010), and `rerank` validates per-candidate scores the same way.
- The 0–10 scale is a convention, not a calibrated probability — only the relative ordering within one batched call is used; absolute score values aren't compared across separate calls or exposed to the user.
