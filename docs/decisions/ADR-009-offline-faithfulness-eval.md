# ADR-009: Faithfulness Checking Is an Offline Eval Tool, Not a Live Query Gate

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Faithfulness checking (ADR-007) requires at least one additional LLM call beyond synthesis itself (the judge call; see ADR-010 for whether decomposition also costs a call). This could run inline on every `/query` request, or as a separate, on-demand process against already-synthesized answers.

## Options considered

**Option A: Wire faithfulness checking into `/query` itself**
- Pros: Product-visible — the frontend could show a live trust signal (e.g. "98% of claims verified") on every answer.
- Cons: Adds an LLM judge call's worth of latency and cost to every real user query, to serve what is fundamentally a measurement and debugging tool, not a feature users asked for. Contradicts the offline design already documented in `docs/DESIGN-DOC.md`'s Evaluation Design section before this ADR was written.

**Option B: Offline eval script (selected)**
- Pros: Runs on-demand against the labeled test set (or any set of question/answer pairs), with no impact on real query latency or cost. Matches the "measurable, not just looks fine" goal without turning every user-facing query into an eval run.
- Cons: Faithfulness regressions aren't caught in real time in production — only when the eval script is run. Acceptable for a portfolio project's current scale; would need reconsideration if this were a production system with a CI-gated eval run per deploy.

## Decision

Faithfulness checking is invoked only by `scripts/eval-faithfulness.ts`, run on demand against a small set of known-good/known-bad answer fixtures (see the script itself for the current cases). `/query` and the frontend are unchanged by this feature.

## Consequences

- No latency or cost impact on real queries.
- The faithfulness signal only exists when someone runs the eval script — there's no dashboard or live indicator today. That's a deliberate scope boundary, not an oversight: turning this into a CI-gated or live-served signal is future work if the eval set and metric bar become established enough to be worth automating.
