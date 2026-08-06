# ADR-005: Insufficient-Evidence Responses Get a Distinct UI State

**Status:** Accepted
**Date:** 2026-08-06

---

## Context

Once `/query` can return `answerable: false` (ADR-004), the frontend needs to render it somehow. The app already has an error state (red "ERROR" tag) for request failures — network errors, 500s.

## Options considered

**Option A: Reuse the existing error state**
- Pros: No new UI code.
- Cons: Conflates two different things. A request failure is the system *not working*. `answerable: false` is the system working correctly and declining to guess — a successful, valid response. Labeling a correct refusal as an "ERROR" would train the user to distrust a signal that is actually the app behaving well.

**Option B: Distinct third state (selected)**
- Pros: Correctly separates "the system is broken" from "the system found insufficient evidence." Chunks are still rendered underneath the refusal message, preserving the one thing the pre-synthesis app already did well — letting the user inspect the raw retrieved evidence themselves.
- Cons: One more visual state to design and maintain (new CSS tag variant).

## Decision

Added a third message state in `src/App.tsx` / `src/App.css`: `answerable === false` renders a muted amber "INSUFFICIENT EVIDENCE" tag (new `--warn` / `.tag--warn` styles, distinct from both the accent "ANSWER" styling and the red error styling) with the refusal text, followed by the same chunk list the confident-answer state shows.

## Consequences

- Verified live in-browser: an off-topic question rendered the amber "INSUFFICIENT EVIDENCE" block with the refusal text and the retrieved chunks visible below it, visually distinct from both a normal answer and a request error.
- One new CSS variable pair (`--warn`, `--warn-dim`) and one new tag class were added; no existing styles were changed.
