# ADR-006: Citation Indices Are Validated, With One Retry, Then Fail Safe

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

`withStructuredOutput()` (ADR-003) guarantees the *shape* of the model's response — `citedChunkIndices` will be an array of numbers — but not that those numbers correspond to real chunks. The model can return a schema-valid response that cites, say, passage 7 when only 4 passages were ever sent to it. Trusting `citedChunkIndices` without checking would let a malformed citation silently look like a normal, grounded answer.

## Options considered

**Option A: Trust the structured output as-is**
- Pros: Simplest; one LLM call per query.
- Cons: A schema-valid-but-semantically-invalid citation would pass through undetected, undermining the entire point of adding structured citations.

**Option B: Validate, retry once, then fail safe (selected)**
- Pros: Catches the common transient case cheaply (one retry with a corrective message naming the valid index range). If the model still can't produce valid citations, the response is downgraded to `answerable: false` with a distinct message — an honest failure — rather than silently stripping the bad citation and presenting the rest as trustworthy.
- Cons: A malformed first response costs a second LLM call (latency + cost) before falling back.

## Decision

`synthesizeAnswer()` validates every index in `citedChunkIndices` is an integer in `[1, chunks.length]` (`hasValidCitations()`). On failure, it retries once with the original prompt plus a corrective note listing the invalid indices and the valid range. If the retry is still invalid, it returns `{ answer: "Something went wrong generating a grounded answer.", citedChunkIndices: [], answerable: false }` and logs the malformed indices server-side (`console.warn`) for observability. Bounded to exactly one retry — not a loop.

## Consequences

- Covered by unit tests (`server/lib/synthesize.test.ts`) exercising all three paths: valid-first-try, invalid-then-valid-retry, invalid-both-times-fallback — with a mocked model, since none of these malformed-citation paths occurred during live testing (the real model behaved correctly both times it was exercised live). This is explicitly noted as verified-by-unit-test-only, not by a live-observed failure.
- The fallback message ("Something went wrong generating a grounded answer") is deliberately distinct from the no-relevant-chunks refusal message (ADR-004), so server logs and future debugging can tell the two failure modes apart even though the frontend renders both through the same "INSUFFICIENT EVIDENCE" state (ADR-005).
