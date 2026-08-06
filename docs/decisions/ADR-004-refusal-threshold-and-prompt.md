# ADR-004: Refusal Handling Combines a Similarity Threshold with a Prompt Instruction

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Once `/query` synthesizes answers (ADR-003), it can hallucinate a confident-sounding answer from retrieved chunks that don't actually support it — the standard RAG failure mode. Two distinct failure shapes need to be prevented: (1) nothing in the corpus is even topically related to the question, and (2) a chunk is topically related but doesn't actually contain the answer (the harder case — e.g. asking about the Widget X200's color when the document never mentions color, despite several chunks being about the Widget X200).

## Options considered

**Option A: Prompt instruction only**
- Pros: No threshold to justify or tune; simplest to implement.
- Cons: Fully dependent on the model following the "say you don't know" instruction. Models can still answer from a topically-close-but-non-answering chunk if not explicitly guarded against.

**Option B: Similarity threshold + prompt instruction, combined (selected)**
- Pros: The threshold is a cheap, deterministic guard for the "nothing in the corpus is even close" case — it skips the LLM call entirely rather than trusting the model to notice. The prompt instruction remains as the only defense for the harder, topically-close-but-unanswered case, which a single numeric threshold cannot reliably catch (a chunk can score well and still not contain the fact asked about).
- Cons: Introduces a threshold value that has to be chosen.

## Decision

`synthesizeAnswer()` (`server/lib/synthesize.ts`) computes the best chunk's similarity (`1 − cosine distance`, clamped to `[0, 1]`) before calling the LLM. If it's below `0.10`, the LLM call is skipped and a static refusal is returned. Otherwise, the LLM is called with an explicit instruction to set `answerable: false` and decline rather than guess if the passages don't answer the question.

**The threshold value is an explicit placeholder, not a tuned constant.** It was set from exactly two real data points observed during manual testing: unrelated content scored ~0.06 similarity, relevant content scored 0.22–0.69. It is deliberately conservative (low), so it only rejects clearly-nothing cases without risking false negatives on real matches. It is not statistically justified and must be revisited once the labeled evaluation set (`docs/DESIGN-DOC.md`, Evaluation Design) exists to measure retrieval quality properly.

## Consequences

- Two independently-verified refusal paths exist: the threshold (verified live — a totally unrelated question skipped the LLM call and returned the static refusal) and the prompt instruction (verified live — a topically-close-but-unanswered question passed the threshold, reached the LLM, and the model correctly declined rather than guessing).
- The `0.10` threshold is known to be unvalidated and is flagged here so it isn't later mistaken for a tuned number.
- Corpora where relevant content legitimately scores below `0.10` similarity (unlikely at this scale, but not measured) would be incorrectly refused before reaching the model.
