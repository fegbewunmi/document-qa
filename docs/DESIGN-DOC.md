# Document Q&A — Architecture Design Document

*Version 1.0 · 2026-08-06*

---

## 1. Problem Framing

### What is this system?

Document Q&A is a retrieval-augmented generation app: upload a PDF, ask questions about it in natural language, get an answer synthesized from the document's actual content with citations back to the specific passages that support it — or an explicit "I don't know" when the document doesn't contain the answer.

### Current state vs. target

An initial audit of the repository (before this expansion) found the system was vector-retrieval-only: `/query` returned ranked chunks with no synthesized answer, despite the original author's intent (confirmed by dead `multer`/`pdf-parse` dependencies and a `/upload` route that was imported but never written) to support the full flow. That baseline has since been restored and extended with answer synthesis. Three further pieces are planned: hybrid retrieval, reranking, and faithfulness evaluation.

### Where the current pipeline is weak (motivating the planned work)

**Hybrid retrieval (implemented and verified).** Vector similarity search embeds meaning, not exact tokens. Demonstrated live: querying the bare SKU `AC-9928-B` (no natural-language framing) against a 6-chunk corpus that includes a semantically-competing "Replacement Parts and Sourcing" chunk (thematically about parts, doesn't contain the SKU), vector-only search ranked the *actual* SKU-containing chunk **3rd** (distance 0.6412) — behind an unrelated filter-maintenance chunk (0.6123) and the competing parts-sourcing chunk (0.6310), both of which happened to embed closer to the bare identifier than the chunk that actually answers the query. Reciprocal Rank Fusion (ADR-011) correctly promoted the SKU chunk to **1st place** by combining the vector ranking with a full-text search that matched it as the sole exact hit. See ADR-011 through ADR-013 for the design and the Project Status table below for the full before/after numbers.

**Reranking (implemented and verified).** Hybrid retrieval's RRF fusion is still a coarse, rank-position-based signal — it has no understanding of whether a candidate actually answers the question. Demonstrated live on a 7-chunk corpus with four superficially similar "sensor shows unusual readings" sections across different fictional product models, only one of which actually requires a technician: for the query "My unit's sensor is showing unusual readings, does it need a technician?", fusion alone ranked the one chunk that actually says "yes, a technician is needed" in **5th place** — outside where a naive top-4 cutoff would ever include it, behind three decoys that all say "no technician needed." Reranking (given the wider top-10 fused set, ADR-016) correctly promoted it to **1st place**. See ADR-014 through ADR-017 and Project Status below for the full numbers.

**Faithfulness evaluation (planned).** Right now, grounding is checked by manually reading the answer against the chunks after the fact — exactly what happened for every live verification tonight. That doesn't scale past a handful of manual checks and gives no systematic signal when a prompt change or model swap quietly degrades grounding. `citedChunkIndices` (ADR-003) exists specifically to make this checkable.

### What this system is not

- Not a multi-document system — one document is active at a time (ADR-001).
- Not a general document-management tool — no document listing, deletion by name, or history.
- Not yet measured at scale — verification so far is a handful of live, manually-checked queries against a few test documents, not an automated eval run over the full pipeline.

---

## 2. Pipeline Architecture

### Current, implemented

```
UPLOAD
  PDF file
    → PDFLoader (pdf.js under langchain)
    → RecursiveCharacterTextSplitter (chunkSize 500, chunkOverlap 100)
    → OpenAIEmbeddings (text-embedding-3-small)
    → TRUNCATE documents table, then store  [ADR-001: replace, not accumulate]
    → CREATE INDEX IF NOT EXISTS ... USING GIN (to_tsvector('english', text))  [ADR-012]

QUERY
  question
    → OpenAIEmbeddings.embedQuery (text-embedding-3-small)
    → vector search (top 10, cosine distance)  +  Postgres full-text search (top 10, ts_rank)   [ADR-011, ADR-012]
    → Reciprocal Rank Fusion (weight/(rank+60), matches langchain's EnsembleRetriever)            [ADR-011, ADR-013]
    → top 10 fused candidates, every one carrying a real cosine distance (never fabricated)       [ADR-013, ADR-016]
    → LLM reranker: 0-10 relevance score per candidate, batched call                              [ADR-014, ADR-015]
    → narrow to top 4 by relevance score (fall back to fused order if any candidate unscored)     [ADR-016, ADR-017]
    → best-chunk similarity < 0.10?
         yes → static refusal, no LLM call            [ADR-004]
         no  → ChatOpenAI.withStructuredOutput (gpt-4o-mini, temperature 0)
                 → { answer, citedChunkIndices, answerable }
                 → citedChunkIndices valid?
                      no → retry once with corrective prompt
                      still invalid → fail safe: answerable=false  [ADR-006]
  → { question, chunks, answer, citedChunkIndices, answerable }

FAITHFULNESS EVAL (offline, on demand — npm run eval:faithfulness)
  synthesized answer
    → extract per-sentence claims from existing [n] citation markers (deterministic, no LLM)  [ADR-010]
    → resolve each claim to its cited chunk(s)
    → LLM judge: supported / unsupported / contradicted, per claim                             [ADR-007, ADR-008]
    → unsupportedClaimRate
```

All three RAG-quality features from the original brief — hybrid retrieval, reranking, and faithfulness evaluation — plus answer synthesis, are now implemented and live-verified. No further pipeline additions are planned as of this writing.

### Components

| Component | File | Responsibility |
|---|---|---|
| Ingestion | `server/routes/upload.ts` | Validate PDF, chunk, embed, replace stored document |
| Retrieval | `server/routes/query.ts` | Embed question, vector search |
| Synthesis | `server/lib/synthesize.ts` | Refusal guard, structured-output LLM call, citation validation |
| Faithfulness eval | `server/lib/faithfulness.ts`, `scripts/eval-faithfulness.ts` | Deterministic claim extraction, per-claim LLM judging, offline runner against known-good/bad fixtures |
| Hybrid retrieval | `server/lib/hybridRetrieve.ts` | Vector + full-text search, RRF fusion, real-distance backfill for keyword-only matches |
| Reranking | `server/lib/rerank.ts` | Per-candidate LLM relevance scoring, narrows widened fused candidates to synthesis's top 4 |
| DB config | `server/db.ts` | Single source of truth for connection + table name (ADR-002) |
| CLI ingestion | `scripts/ingest.ts` | Standalone one-off ingestion, independent of the web upload path |

---

## 3. Data Contracts

### `POST /upload`

Request: `multipart/form-data`, field `file` (must be `application/pdf`, ≤20MB).

```json
// 200
{ "message": "Ingested 4 chunks from test-doc.pdf" }

// 400 — missing file, wrong type, or over size limit
{ "error": "A PDF file is required" }
```

### `POST /query`

```json
// Request
{ "question": "What does error code E-4471 mean and what part fixes it?" }

// 200
{
  "question": "What does error code E-4471 mean and what part fixes it?",
  "chunks": [
    { "text": "...", "score": 0.31, "metadata": { "source": "test-doc.pdf", "...": "..." } }
  ],
  "answer": "Error code E-4471 indicates a coolant pressure sensor failure. The part that fixes it is the replacement sensor with SKU AC-9928-B [1].",
  "citedChunkIndices": [1],
  "answerable": true
}
```

`chunks[].score` is cosine **distance** (lower = better match), not similarity — see ADR/rationale on the frontend display fix. `citedChunkIndices` is 1-based, indexing into `chunks` in the order returned (same order the frontend numbers them 01, 02, ...).

This supersedes the response shape documented in the original README, which predated answer synthesis and showed chunks-only.

---

## 4. Evaluation Design

### Principle

Written before hybrid retrieval, reranking, or faithfulness evaluation are implemented — so it describes what "improved" will mean before any of the three features that are supposed to produce improvement exist. Answer synthesis was implemented first (explicit sequencing decision, since faithfulness evaluation needs synthesis to exist before it has anything to grade) — this document is being written retroactively for that one piece, and prospectively for the other three.

### Test corpus

A single synthetic fixture, `test-doc.pdf` (a "Widget X200 Maintenance Guide" — error codes, warranty terms, a maintenance schedule), chosen because it contains exact-match tokens (an error code, a SKU) alongside prose facts, making it usable for both semantic-retrieval and exact-match test cases without needing two documents.

### Labeled test set (starter — 5 questions)

| ID | Question | Expected behavior | Expected key facts / correct source | Verification status |
|---|---|---|---|---|
| Q-001 | "What does error code E-4471 mean and what part fixes it?" | Grounded answer | Coolant pressure sensor failure; SKU AC-9928-B; "Error Codes" passage | **Verified live** — correct answer, correctly cited chunk 1 |
| Q-002 | "How long is the warranty period?" | Grounded answer | 3 years, parts and labor; "Warranty" passage | Retrieval-only verified (pre-synthesis); **not yet re-run through synthesis** |
| Q-003 | "How often should filters be replaced?" | Grounded answer | Every 90 days; "Maintenance Schedule" passage | Retrieval-only verified (pre-synthesis); **not yet re-run through synthesis** |
| Q-004 | "What is the capital of France?" | Refusal — out-of-corpus | `answerable: false`, threshold guard trips, no LLM call | **Verified live** |
| Q-005 | "What color is the Widget X200?" | Refusal — topically close, not answered | `answerable: false`, LLM called (passes threshold) and correctly declines | **Verified live** |
| Q-006 | "AC-9928-B" (bare identifier, no framing) | Grounded answer; exercises hybrid retrieval specifically | On a corpus with a semantically-competing chunk, vector-only misranks the correct chunk 3rd; hybrid retrieval must rank it 1st | **Verified live** — see Hybrid Retrieval problem framing above for full numbers |
| Q-007 | "My unit's sensor is showing unusual readings, does it need a technician?" | Grounded answer; exercises reranking specifically | On a corpus with four decoy "sensor" sections, fusion alone misranks the correct chunk 5th (outside a naive top-4); reranking must promote it to 1st | **Verified live** — see Reranking problem framing above for full numbers |

This is intentionally small and will grow once hybrid retrieval and reranking need harder cases — in particular, a bare-SKU-only query (no natural-language framing) is the planned test case for hybrid retrieval (see Problem Framing above), and isn't included yet because vector-only retrieval has no mechanism to pass it.

### Metrics

| Metric | What it measures | Depends on | Status |
|---|---|---|---|
| Retrieval hit rate | % of questions where the correct source passage is in top-k | Retrieval only | Not instrumented |
| Answer correctness | Does the synthesized answer contain the expected key facts | Synthesis | Not instrumented |
| Citation accuracy | Does `citedChunkIndices` point at the actually-correct passage, not just any passage | Synthesis | Not instrumented |
| Faithfulness / unsupported-claim rate | % of answer claims not supported by the chunks they cite | `checkFaithfulness()` (`server/lib/faithfulness.ts`) | **Instrumented and verified live** — `npm run eval:faithfulness` correctly scored 3/3 known-good answers at 0% and correctly flagged 3/3 known-bad answers |
| Refusal accuracy | Correct refusals on Q-004/Q-005-style questions, without false refusals on answerable ones | Synthesis refusal logic | Verified manually (live, not automated) — see Project Status |

**No hard ship thresholds are set yet.** Picking a number now (e.g. "≥ 80% correctness") on a 5-question set would repeat the exact mistake flagged in ADR-004's threshold caveat — a guess presented as a validated bar. Thresholds should be set once the labeled set is large enough that a percentage means something.

---

## 5. ADR Log

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](decisions/ADR-001-replace-on-upload.md) | Upload replaces the indexed document, not accumulate | Accepted |
| [ADR-002](decisions/ADR-002-centralized-db-config.md) | Centralized DB config via `DATABASE_URL`, not per-file hardcoding | Accepted |
| [ADR-003](decisions/ADR-003-structured-answer-output.md) | Structured output (Zod schema) for synthesized answers and citations | Accepted |
| [ADR-004](decisions/ADR-004-refusal-threshold-and-prompt.md) | Refusal handling combines a similarity threshold with a prompt instruction | Accepted |
| [ADR-005](decisions/ADR-005-insufficient-evidence-ui-state.md) | Insufficient-evidence responses get a distinct UI state, not the error state | Accepted |
| [ADR-006](decisions/ADR-006-citation-index-validation.md) | Citation indices are validated, with one retry, then fail safe | Accepted |
| [ADR-007](decisions/ADR-007-per-claim-faithfulness-judge.md) | Faithfulness checked per-claim via LLM judge, decomposed at eval time | Accepted |
| [ADR-008](decisions/ADR-008-three-way-verdict-scale.md) | Three-way verdict scale: supported / unsupported / contradicted | Accepted |
| [ADR-009](decisions/ADR-009-offline-faithfulness-eval.md) | Faithfulness checking is an offline eval tool, not a live query gate | Accepted |
| [ADR-010](decisions/ADR-010-deterministic-claim-extraction.md) | Claims extracted deterministically from citation markers, not a second LLM call | Accepted |
| [ADR-011](decisions/ADR-011-reciprocal-rank-fusion.md) | Reciprocal Rank Fusion for hybrid retrieval, not weighted combination or keyword pre-filter | Accepted |
| [ADR-012](decisions/ADR-012-postgres-full-text-search.md) | Postgres full-text search for the keyword signal, not an in-memory BM25 retriever | Accepted |
| [ADR-013](decisions/ADR-013-hand-rolled-rrf-preserves-scores.md) | RRF implemented directly, not via EnsembleRetriever, to preserve per-chunk distance | Accepted |
| [ADR-014](decisions/ADR-014-llm-as-reranker.md) | LLM-as-reranker, not a cross-encoder — stack consistency over raw precision | Accepted |
| [ADR-015](decisions/ADR-015-batched-relevance-scoring.md) | Per-candidate batched relevance scoring, not direct reordering | Accepted |
| [ADR-016](decisions/ADR-016-widen-then-narrow-candidates.md) | Candidate pool widened to 10 for reranking, narrowed back to top-4 afterward | Accepted |
| [ADR-017](decisions/ADR-017-rerank-fallback-to-fused-order.md) | An incomplete reranker response discards the rerank, falls back to fused order | Accepted |

Full ADR text (context, options, consequences) for each decision: `docs/decisions/`.

---

## 6. Project Status

| Piece | Status |
|---|---|
| Baseline retrieval (`/upload`, `/query` chunk search) | **Verified** — restored from broken state, live-tested end-to-end including replace semantics |
| Score display (% match) | **Verified** — fixed, unit-tested, confirmed live in-browser |
| Answer synthesis | **Verified** — live-tested for golden path and both refusal paths; citation-validation retry/fallback covered by unit tests only, not observed live |
| Faithfulness evaluation | **Verified** — `npm run eval:faithfulness` run live against 3 known-good/known-bad answer pairs; the real LLM judge correctly scored every faithful answer at 0% unsupported and correctly flagged every injected error (both unsupported-addition and contradicted-number failure modes) |
| Hybrid retrieval | **Verified** — live before/after comparison on a bare-SKU query (`AC-9928-B`) against a 6-chunk corpus with a semantically-competing chunk: vector-only ranked the correct chunk 3rd (distance 0.6412, behind 0.6123 and 0.6310); RRF-fused hybrid retrieval correctly promoted it to 1st. Full `/query` round-trip re-verified afterward (correct synthesized answer, correct citation), and prior golden-path/refusal regression checks re-run with no change in behavior |
| Reranking | **Verified** — live before/after comparison on a 7-chunk corpus with four superficially similar decoy chunks: fusion alone ranked the one chunk that actually answers "does it need a technician?" correctly (yes) in 5th place, behind three decoys saying "no"; reranking (given the widened top-10 candidate set) correctly promoted it to 1st. Full `/query` round-trip re-verified — synthesized answer correctly distinguished the two cases and cited both relevant chunks. Prior golden-path/refusal regression checks re-run with no change in behavior |

**Test coverage:** `npm test` (vitest) — 43 tests covering `toMatchPercent`, `similarityFromDistance`, `hasValidCitations`, `synthesizeAnswer`'s refusal/retry/fallback branches, `extractClaims`'s sentence/citation-marker parsing, `checkFaithfulness`'s verdict aggregation and fallback behavior, `reciprocalRankFusion`/`hybridRetrieve`'s fusion math and real-distance backfill, and `rerank`'s score-based reordering and fused-order fallback behavior. `npm run eval:faithfulness` is a separate, on-demand live check (real OpenAI calls) that the faithfulness judge actually discriminates faithful from unfaithful answers — not part of `npm test` since it costs real API calls and isn't a pure unit test. `npm run build` type-checks the frontend; the backend (`server/`) is checked ad hoc (no project `tsconfig` currently covers it — a known gap from the original audit, not yet closed).
