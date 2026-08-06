# ADR-007: Faithfulness Checked Per-Claim via LLM Judge, Decomposed at Eval Time

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

`citedChunkIndices` (ADR-003) records which chunks the model *claims* support its answer, but nothing verifies the claim is actually true — the model could cite a real chunk and still assert something that chunk doesn't say. There is currently no systematic check for this; verification so far has been a human reading the answer against the chunks by hand for each live test.

## Options considered

**Option A: Holistic LLM-as-judge**
- Pros: One extra LLM call per answer; simplest to implement.
- Cons: A judge skimming a whole paragraph against several passages at once is coarse — a single wrong detail is easy to miss, and a failure verdict gives no indication of *which* claim broke. Not useful for debugging a synthesis regression.

**Option B: Per-claim judge, schema change at synthesis time**
- Pros: Synthesis emits claims directly (`claims: [{text, chunkIndices}]`), so eval needs no decomposition step.
- Cons: Reopens ADR-003. Adds cost/latency to *every* user query (not just eval runs) to serve a feature only the offline eval harness uses. Requires re-touching the synthesis prompt, the `/query` response shape, and the frontend rendering — meaningfully more invasive than the benefit (skipping one eval-time step) justifies.

**Option C: Per-claim judge, decomposed at eval time (selected)**
- Pros: Synthesis's schema is untouched — no changes to `/query`, the frontend, or ADR-003's decision. All new cost/latency is isolated to eval runs, consistent with the offline design (ADR-009). The judge checks one claim against its specific cited chunk at a time, which is a narrower, more reliable task for an LLM than holistic judgment, and produces a per-claim verdict that's directly debuggable.
- Cons: Requires a decomposition step to split the answer into claims before judging (see ADR-010 for how that's done without a second LLM call).

## Decision

Faithfulness checking (`server/lib/faithfulness.ts`) decomposes a synthesized answer into individual claims, resolves each claim's cited chunk(s), and asks an LLM judge for a per-claim verdict against only the chunk(s) that claim cites — rather than judging the whole answer against the whole chunk set at once, and rather than changing what synthesis itself produces.

## Consequences

- Faithfulness checking is fully decoupled from synthesis — either can change independently.
- A failed faithfulness check names the specific claim and chunk involved, not just "something's wrong."
- Requires resolving `[n]` markers back to specific claims before judging — addressed by ADR-010.
