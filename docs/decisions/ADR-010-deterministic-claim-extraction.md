# ADR-010: Claims Extracted Deterministically From Citation Markers, Not via a Second LLM Call

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Per-claim judging (ADR-007) requires splitting the synthesized answer into individual claims before judging each one. The synthesis prompt (ADR-003) already instructs the model to place inline `[n]` citation markers directly in the answer text, next to the specific claim(s) they support — this structure already exists in every synthesized answer today.

## Options considered

**Option A: LLM-based claim decomposition**
- Pros: More flexible — could in principle split compound sentences into finer-grained claims than sentence boundaries allow, and handle citation placement the model expressed unusually.
- Cons: A second structured-output LLM call, with its own failure modes (malformed output, inconsistent segmentation) that would need its own validation logic — the exact category of risk ADR-006 already had to guard against once. Uses an LLM to do a largely mechanical task the citation markers already make legible.

**Option B: Deterministic sentence + bracket-marker parsing (selected)**
- Pros: No extra LLM call. Fully unit-testable with plain string/regex logic, no mocking required. Reuses the citation-marker mechanism ADR-003 already built rather than asking a second model call to rediscover claim boundaries the first call already expressed. Fails predictably (a claim with no valid marker is conservatively treated as unsupported — no chunk to check it against).
- Cons: Sentence-level granularity, not clause-level — a single sentence asserting two facts that cite *different* chunks would be checked as one combined claim rather than two. Uncited sentences (no `[n]` marker at all) are excluded from checking entirely — this checker verifies that *cited* claims are faithful to what they cite; it does not separately catch the different failure mode of an uncited assertion. That's a known, explicit scope boundary, not an oversight.

## Decision

`server/lib/faithfulness.ts` splits the answer on sentence boundaries, extracts `[n]` markers per sentence via regex, and resolves each to its cited chunk text. Sentences with no citation markers are skipped (not checked). Markers pointing outside `[1, chunks.length]` are dropped from that claim; a claim left with no valid citation is automatically verdict `"unsupported"` (no LLM call needed for that case — there's nothing to check it against).

## Consequences

- No new LLM call is added beyond the per-claim judge call itself.
- Claim extraction logic is deterministic and covered by unit tests with no mocking.
- Compound sentences citing multiple different chunks for different sub-facts are checked as a single combined claim against the union of cited chunks, not split further — a known granularity limit, acceptable at the current answer complexity (synthesis prompts favor short, single-fact sentences).
- Uncited factual assertions are out of scope for this checker. If that failure mode becomes a real observed problem, it needs a different check (e.g. comparing the answer's asserted facts against all chunks, not just cited ones) — not assumed to be covered here.
