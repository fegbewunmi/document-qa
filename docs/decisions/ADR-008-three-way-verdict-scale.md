# ADR-008: Three-Way Verdict Scale (Supported / Unsupported / Contradicted)

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Once each claim is judged against its cited chunk (ADR-007), the judge needs a verdict scale. Two claim failures are not equally severe: a claim the chunk simply doesn't mention (e.g. an added but plausible-sounding detail) is a different, less severe problem than a claim the chunk actively contradicts (e.g. stating a warranty period different from the one the document actually states).

## Options considered

**Option A: Binary — supported / unsupported**
- Pros: Simpler prompt and schema.
- Cons: Collapses two meaningfully different failure modes into one label, losing information that's useful both for debugging ("did the model add something, or get something backwards?") and for prioritizing fixes (a contradiction is a worse failure than an unstated addition).

**Option B: Three-way — supported / unsupported / contradicted (selected)**
- Pros: Distinguishes "not mentioned" from "actively wrong." Small addition to the judge's schema and prompt over Option A.
- Cons: Slightly more nuanced judgment required per claim, though this is well within what a `temperature: 0` LLM judge handles reliably for short, single-claim-against-single-chunk comparisons.

## Decision

The faithfulness judge (`server/lib/faithfulness.ts`) returns one of `"supported" | "unsupported" | "contradicted"` per claim.

## Consequences

- The aggregate `unsupportedClaimRate` metric counts both `unsupported` and `contradicted` claims as failures, but the per-claim detail preserves which kind of failure occurred for debugging.
- Test fixtures for verifying the judge (see the eval script) include a deliberately *contradicted* case, not just an *unsupported* one, so both failure modes are exercised, not just assumed to work from the "unsupported" case alone.
