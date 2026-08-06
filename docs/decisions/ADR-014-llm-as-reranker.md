# ADR-014: LLM-as-Reranker Instead of a Cross-Encoder

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Hybrid retrieval (ADR-011) fuses two cheap, coarse signals — embedding similarity and text-search rank — to get broad recall efficiently. Neither signal actually evaluates whether a candidate answers the specific question asked; RRF's fused score is purely a function of rank position in two independently-computed lists. Reranking re-scores a widened candidate set with something more precise before narrowing to what synthesis sees (see ADR-016 for the widen-then-narrow pipeline change this implies).

## Options considered

**Option A: Cross-encoder**
- Pros: The standard, purpose-built approach — jointly encodes query and passage instead of comparing separately-encoded embeddings, capturing finer relevance signal than cosine similarity can. Typically higher raw ranking precision and cheaper per-call than an LLM at production scale.
- Cons: Nothing in the current stack provides one. Requires either a new vendor (e.g. Cohere's Rerank API — new API key, new billing relationship, new failure mode) or running a local model in Node (a new ML-runtime dependency, e.g. `@xenova/transformers`). Both are a genuine stack expansion the project brief explicitly scoped out ("this isn't a GCP migration... keep the existing stack").

**Option B: LLM-as-reranker (selected)**
- Pros: Reuses the OpenAI + LangChain structured-output pattern already established twice (synthesis, ADR-003; the faithfulness judge, ADR-007) — same architecture, same defensibility story, no new dependency or vendor.
- Cons: Slower and more expensive per query than a purpose-built cross-encoder — a real cost, not a free choice. Likely somewhat lower raw ranking precision in a benchmark sense than a model trained specifically for reranking.

**Option C (rejected as a category, not just weaker): "Better first-pass tuning"**
- Improving the first-pass retrieval signal itself doesn't answer "add reranking" — it's a different feature. The two-stage recall-then-precision architecture is exactly why reranking exists as a separate stage in production RAG systems; if first-pass tuning alone were sufficient, no system would need a second stage at all.

## Decision

Reranking uses an LLM (via `ChatOpenAI.withStructuredOutput()`, `server/lib/rerank.ts`) to score the widened candidate set, consistent with every other LLM-driven component in this codebase.

## Consequences

- No new vendor or dependency; the reranker follows the same dependency-injected, unit-testable pattern (`RerankerModel` interface) as `StructuredAnswerModel` (ADR-003) and `FaithfulnessJudgeModel` (ADR-007).
- Adds one more LLM call per query, on top of embeddings and synthesis — a real latency/cost cost, accepted for stack consistency over raw reranking precision.
- If ranking quality at production scale ever becomes the binding constraint, a cross-encoder is the documented alternative — this ADR names the tradeoff explicitly rather than treating LLM-as-reranker as free.
