# ADR-003: Structured Output for Synthesized Answers and Citations

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

`/query` originally returned only ranked chunks — confirmed by direct code audit, with no LLM call anywhere in the codebase. The user has to manually read up to 4 passages and stitch together an answer. Example: asking "What does error code E-4471 mean and what part fixes it?" against the test corpus returns 4 unordered passages; the user has to notice that one names the failure mode and another names the replacement part, then combine them manually.

Adding an answer-synthesis step requires choosing how the model's answer and its citations are represented in the response — a choice made harder by the fact that faithfulness evaluation (planned next) needs to check whether the synthesized answer's claims are actually supported by the chunks it cites.

## Options considered

**Option A: Plain text with inline `[n]` citation markers only**
- Pros: Simple; human-readable immediately with no parsing.
- Cons: Faithfulness evaluation would have to regex-parse `[n]` markers and pattern-match "I don't know" phrasing out of free text — both fragile, and a source of bugs in the very next piece of work.

**Option B: Structured output via LangChain's `withStructuredOutput()` (selected)**
- Pros: Model returns `{ answer, citedChunkIndices, answerable }` via a Zod schema. `answer` still contains inline `[n]` markers for human display, but `citedChunkIndices` and `answerable` are machine-reliable fields the next feature (faithfulness evaluation) can consume directly instead of parsing prose.
- Cons: Slightly more setup than free text; depends on the model's function-calling / structured-output support (already available in the installed `@langchain/openai` version).

## Decision

`/query`'s answer synthesis uses `ChatOpenAI.withStructuredOutput()` bound to a Zod schema: `{ answer: string, citedChunkIndices: number[], answerable: boolean }`. Implemented in `server/lib/synthesize.ts`.

This is a sequencing decision, not just an output-format preference: building the data shape the next consumer (faithfulness evaluation) actually needs, rather than the minimum for synthesis alone, avoids rework the very next step would otherwise require.

## Consequences

- `/query`'s response grows additively: `{ question, chunks, answer, citedChunkIndices, answerable }`. Existing chunk-only consumers are unaffected.
- Faithfulness evaluation can build directly on `citedChunkIndices` instead of parsing free text.
- One additional OpenAI chat call per query (skipped when the refusal threshold trips — see ADR-004), increasing latency and cost versus retrieval-only.
