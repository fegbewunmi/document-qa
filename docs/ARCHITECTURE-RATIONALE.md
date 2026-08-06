# Architecture Rationale

_Why we made the decisions we made — answers for design reviews and interviews._

This document explains the non-obvious decisions behind Document Q&A. The ADRs in `docs/decisions/` capture the formal record of each decision; this document captures the reasoning behind them in plain language.

---

## 1. Why pgvector instead of a dedicated vector database?

The stack was already Postgres for anything relational; adding the `pgvector` extension to the same instance means one fewer moving part — no separate vector-DB API key, no additional failure mode, no data-residency question. The corpus is a single small document at a time (the app is explicitly single-document, see #3 below), which an `ivfflat`-free brute-force cosine search over a few dozen rows handles instantly. This is the same reasoning AI Operations Center used for its own Cloud SQL + pgvector choice, and it holds here for the same reason: the corpus size doesn't come close to justifying a dedicated engine yet, and the migration path (swap the vector store implementation in `server/db.ts` and the two routes that use it) stays open if that changes.

## 2. Why did the "% match" display need a fix that had nothing to do with retrieval logic?

`PGVectorStore.similaritySearchWithScore()` returns cosine **distance** — 0 means identical, higher means less similar — because that's what pgvector's `<=>` operator computes and what LangChain passes through unmodified. The frontend was computing `Math.round(score * 100)}% match` directly on that distance, which silently inverted the entire display: the best-matching passage in a real test showed "31% match" and the worst showed "94% match." The fix (`src/lib/matchPercent.ts`) inverts it — `similarity = 1 - distance`, clamped to `[0, 1]`. Nothing about retrieval ranking was ever wrong; the SQL `ORDER BY _distance ASC` already returned best-match-first. Only the number shown next to each result was backwards. This is exactly the kind of bug that survives casual testing — the ordering looks right, the top result is the right passage, and only a careful check of what the raw number actually means catches it.

## 3. Why does uploading a new PDF replace the old one instead of accumulating?

The frontend UI already said "Replace PDF" once a document was active, before the `/upload` route that would make that true even existed (see ADR-001). Rather than build a multi-document scoping model that the UI never asked for, the simpler fix was to make the backend actually do what the UI already promised: truncate the `documents` table on every upload. The alternative — accumulate chunks across uploads with a `documentId` column and per-query filtering — is the architecturally "more correct" long-term answer, but it's meaningfully more scope than restoring a missing route, and nothing in this app currently needs more than one active document at a time.

## 4. Why centralize database config instead of leaving it alone?

`server/routes/query.ts` hardcoded its Postgres connection inline while `scripts/ingest.ts` read `DATABASE_URL` from `.env` — the kind of inconsistency that works fine until someone changes their `.env` and only one of the two entry points picks it up. Adding the new `/upload` route was the forcing function to fix this: it needed database config too, and writing a third independent copy would have made the drift risk worse, not better. `server/db.ts` is a small, mechanical extraction — no behavior changed for anyone whose `.env` matches the README's documented defaults, which is everyone today.

## 5. Why structured output (Zod schema) instead of the model just writing prose with `[1]` citations?

This is a sequencing decision more than a style preference. Prose-with-brackets would work fine for answer synthesis in isolation — but faithfulness evaluation (the next piece of work) needs to check whether the answer's claims are actually supported by the chunks it cites, and that's much harder to do reliably against free text than against a machine-checkable `citedChunkIndices: number[]` field. Building the data shape the next consumer actually needs, rather than the minimum for the current step, avoids doing this work twice. The `answer` string still contains inline `[n]` markers for human readability — the structured fields are additive, not a replacement for the readable version.

## 6. Why both a similarity threshold and a prompt instruction for refusing to answer?

These guard against two different failure shapes, and neither alone covers both. A hardcoded similarity threshold can cheaply catch "nothing in the corpus is even topically related" — verified live with an out-of-domain question that never reached the LLM at all. But a threshold can't catch the harder case: a chunk that scores well because it's topically close (the passage literally describes the product being asked about) but doesn't contain the specific fact the question asks for. Only the model itself, reading the actual passage content, can tell "topically relevant" apart from "actually answers this." Both were verified live tonight as genuinely distinct code paths, not just distinct in theory.

The threshold's specific value (`0.10` similarity) is explicitly documented as an unvalidated placeholder derived from two data points, not a tuned constant — naming a placeholder as a placeholder is what makes it trustworthy later, versus quietly picking a number and never mentioning the guess.

## 7. Why is "insufficient evidence" a different UI state than an error, rather than reusing the red error styling?

An error means the system didn't work — a network failure, a 500. `answerable: false` means the system worked exactly right and correctly declined to guess. Rendering a correct refusal in red "ERROR" styling would teach the user to distrust the app's most trustworthy signal — the one time it's telling you it doesn't know rather than making something up. The distinct amber state still shows the retrieved chunks underneath, so the one thing the pre-synthesis app already did well — letting the user see the raw evidence — isn't lost behind the new synthesis layer.

## 8. Why validate `citedChunkIndices` instead of trusting the structured output?

Structured output (#5) guarantees shape, not correctness. A response can be perfectly valid JSON — `citedChunkIndices: [7]` — while citing a passage that was never sent to the model, because only 4 passages existed. Silently trusting that would defeat the entire reason structured citations exist: to give faithfulness evaluation something reliable to check. The one-retry-then-fail-safe pattern treats a malformed citation as recoverable on the first pass (models do make transient mistakes) but refuses to paper over a repeated failure by stripping the bad citation and presenting the rest as trustworthy — an honest `answerable: false` is better than a citation that silently points at nothing.
