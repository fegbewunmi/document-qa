# ADR-011: Reciprocal Rank Fusion for Hybrid Retrieval

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Vector similarity search embeds meaning, not exact tokens. A query dominated by an exact identifier (an error code, a SKU) isn't guaranteed to score highest against the one passage containing that literal string, because cosine similarity measures overall semantic shape, not substring presence. Keyword/full-text search catches exact identifiers trivially but misses paraphrases and semantic matches vector search is good at. Neither alone is sufficient; combining them requires a fusion strategy.

## Options considered

**Option A: Keyword as a pre-filter**
- Pros: Simple to implement — narrow to keyword matches, then rank by vector similarity within that set (or vice versa).
- Cons: This narrows rather than fuses. A chunk that's semantically relevant but shares no exact keywords with the query — precisely the case vector search exists to catch — gets filtered out before vector search ever sees it. Doesn't solve the motivating problem; makes it worse in one direction.

**Option B: Weighted score combination**
- Pros: Preserves magnitude information (how much better one match is than another), not just rank order.
- Cons: Requires normalizing cosine similarity and text-search rank onto a common scale — two fundamentally incomparable measures — and picking a blend weight (`α`) without real tuning data. The same category of unjustified-guess-presented-as-a-decision already flagged as a placeholder in ADR-004.

**Option C: Reciprocal Rank Fusion, RRF (selected)**
- Pros: Combines by rank position, not raw magnitude, sidestepping the cross-scale normalization problem entirely. Industry-standard default (Elasticsearch, Weaviate, Azure AI Search). `langchain`'s own `EnsembleRetriever` (already installed, no new dependency) implements this exact formula — `score = Σ weight / (rank + c)`, `c = 60` — from the original RRF paper (Cormack et al., 2009), a well-established default rather than a number chosen tonight.
- Cons: Discards magnitude — a very strong vector match and a barely-passing one are treated identically if both rank 1st in their respective lists. Acceptable: the point of fusion is combining *which* results are relevant across two retrieval modes, not fine-grained magnitude comparison within one mode.

## Decision

Hybrid retrieval fuses vector search and Postgres full-text search (ADR-012) results using Reciprocal Rank Fusion with equal weights (`0.5`/`0.5`) and `c = 60`, matching the formula and default constant used by `langchain`'s `EnsembleRetriever`.

## Consequences

- No blend weight was invented — the fusion math matches a vetted, widely-used implementation and a literature-established constant.
- Implemented as a small hand-rolled function rather than calling `EnsembleRetriever` directly — see ADR-013 for why.
- Equal weighting between vector and keyword signals is itself an assumption, not tuned against the labeled eval set. Worth revisiting if the eval set (`docs/DESIGN-DOC.md`) grows large enough to measure whether one signal should be weighted more heavily than the other.
