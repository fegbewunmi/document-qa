# Document Q&A - RAG Pipeline

A full-stack document question-answering app. Upload any PDF and query it using natural language. Relevant passages are retrieved using vector similarity search, then synthesized into a grounded natural-language answer with citations back to the source passages - or an explicit refusal if the document doesn't contain the answer.

**Stack:** React · TypeScript · Node.js · Express · PostgreSQL · pgvector · OpenAI · LangChain

---

## How it works

1. User uploads a PDF via the UI, which replaces any previously indexed document
2. The backend chunks the document and generates embeddings using OpenAI's `text-embedding-3-small` model
3. Embeddings are stored in PostgreSQL using the pgvector extension, and a full-text search index is built alongside it
4. When a question is submitted, the backend runs vector similarity search *and* Postgres full-text search in parallel, then fuses the two ranked lists with Reciprocal Rank Fusion - catching exact-match queries (error codes, SKUs) that vector search alone can miss
5. The fused top 10 candidates are re-scored by an LLM reranker and narrowed to the 4 most relevant - catching cases where superficially similar passages outrank the one that actually answers the question
6. The top 4 reranked passages are returned with match scores
7. If a passage is relevant enough, an LLM synthesizes a natural-language answer from those passages, with inline citations back to the specific passage(s) it drew from - otherwise the app says so explicitly rather than guessing

See [docs/DESIGN-DOC.md](docs/DESIGN-DOC.md) for the full pipeline architecture, and [docs/ARCHITECTURE-RATIONALE.md](docs/ARCHITECTURE-RATIONALE.md) for the reasoning behind each decision.

---

## Project Structure

```
document-qa/
├── src/                     # React frontend (Vite + TypeScript)
│   ├── App.tsx
│   ├── App.css
│   └── lib/matchPercent.ts  # distance → % match display conversion
├── server/                  # Express backend
│   ├── index.ts
│   ├── db.ts                    # shared DB config (DATABASE_URL)
│   ├── lib/synthesize.ts        # answer synthesis: refusal guard, structured output, citation validation
│   ├── lib/faithfulness.ts      # claim extraction + per-claim LLM faithfulness judge
│   ├── lib/hybridRetrieve.ts    # vector + full-text search, RRF fusion
│   ├── lib/rerank.ts            # LLM relevance scoring, narrows fused candidates to top 4
│   └── routes/
│       ├── query.ts         # hybrid retrieval + answer synthesis endpoint
│       └── upload.ts        # PDF ingestion endpoint (replaces prior document)
├── scripts/
│   ├── ingest.ts             # one-off CLI ingestion script (independent of /upload)
│   └── eval-faithfulness.ts  # on-demand faithfulness judge verification (npm run eval:faithfulness)
├── docs/
│   ├── DESIGN-DOC.md
│   ├── ARCHITECTURE-RATIONALE.md
│   └── decisions/           # ADRs
└── .env
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL + pgvector)
- OpenAI API key

### 1. Clone the repo

```bash
git clone https://github.com/fegbewunmi/document-qa.git
cd document-qa
npm install
```

### 2. Set up environment variables

Create a `.env` file in the root:

```env
OPENAI_API_KEY=your_openai_api_key
DATABASE_URL=postgresql://postgres:password@localhost:5433/ragdb
```

### 3. Start the database

```bash
docker run -d \
  --name pgvector \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=ragdb \
  -p 5433:5432 \
  pgvector/pgvector:pg16
```

Then create the vector extension:

```bash
docker exec -it pgvector psql -U postgres -d ragdb -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 4. Start the backend

```bash
npm run server
```

### 5. Start the frontend

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## API Endpoints

| Method | Endpoint  | Description                        |
|--------|-----------|------------------------------------|
| POST   | /upload   | Upload and ingest a PDF            |
| POST   | /query    | Query the indexed document         |

### POST /upload
Replaces any previously indexed document (see ADR-001).
```json
// multipart/form-data, field "file" (application/pdf, ≤20MB)
{ "file": "<pdf file>" }

// Response 200
{ "message": "Ingested 42 chunks from document.pdf" }

// Response 400 — missing file, wrong type, or over the size limit
{ "error": "A PDF file is required" }
```

### POST /query
```json
// Request
{ "question": "What does error code E-4471 mean and what part fixes it?" }

// Response 200
{
  "question": "What does error code E-4471 mean and what part fixes it?",
  "chunks": [
    {
      "text": "...",
      "score": 0.31,
      "metadata": { "source": "document.pdf" }
    }
  ],
  "answer": "Error code E-4471 indicates a coolant pressure sensor failure. The part that fixes it is the replacement sensor with SKU AC-9928-B [1].",
  "citedChunkIndices": [1],
  "answerable": true
}
```

`chunks[].score` is cosine **distance** from pgvector (lower = better match) - not a similarity percentage. The frontend converts it for display (`src/lib/matchPercent.ts`); don't read it as "score% match" directly. `citedChunkIndices` is 1-based, indexing into `chunks` in the order returned. If the document doesn't contain enough information to answer, `answerable` is `false` and `citedChunkIndices` is empty — the app declines rather than guessing.

---

## Key Technical Decisions

- **pgvector over a hosted vector DB** - keeps the stack simple and colocated with relational data, which mirrors real production setups
- **Chunk overlap (100 tokens)** - preserves context across chunk boundaries to improve retrieval quality
- **On-the-fly ingestion** — documents are embedded and stored at upload time, so queries are fast and stateless
- **`text-embedding-3-small`** — balances cost and performance for document retrieval tasks
- **Replace, not accumulate, on upload** — a new upload replaces the previously indexed document rather than blending both into the same search space (ADR-001)
- **Structured output for answer synthesis** — the model returns `{ answer, citedChunkIndices, answerable }` via a Zod schema rather than free text, so citations and refusals are machine-checkable, not string-parsed (ADR-003)
- **Refusal on low-confidence retrieval** — a similarity-threshold guard plus an explicit prompt instruction both defend against hallucinating an answer when the document doesn't contain one (ADR-004)
- **Hybrid retrieval via Reciprocal Rank Fusion** - vector search and Postgres full-text search are fused by rank rather than blended by a hand-picked weight, avoiding the cross-scale normalization problem of combining cosine similarity with text-search rank (ADR-011)
- **LLM reranking over a widened candidate set** — retrieval fuses the top 10 candidates, not just 4, so a per-candidate LLM relevance pass has real headroom to promote a chunk first-pass ranking missed entirely, not just reorder an already-narrow set (ADR-014, ADR-016)

## Documentation

| Doc | Contents |
|---|---|
| [Design Doc](docs/DESIGN-DOC.md) | Problem framing, pipeline architecture, data contracts, evaluation design |
| [Architecture Rationale](docs/ARCHITECTURE-RATIONALE.md) | Why each non-obvious decision was made — plain-language answers for design reviews |
| [ADR Log](docs/decisions/) | Full context/options/decision/consequences for each architectural decision |

### Architecture Decision Records

| ADR | Decision |
|---|---|
| [ADR-001](docs/decisions/ADR-001-replace-on-upload.md) | Upload replaces the indexed document, not accumulate |
| [ADR-002](docs/decisions/ADR-002-centralized-db-config.md) | Centralized DB config via `DATABASE_URL` |
| [ADR-003](docs/decisions/ADR-003-structured-answer-output.md) | Structured output for synthesized answers and citations |
| [ADR-004](docs/decisions/ADR-004-refusal-threshold-and-prompt.md) | Refusal handling: similarity threshold + prompt instruction |
| [ADR-005](docs/decisions/ADR-005-insufficient-evidence-ui-state.md) | Insufficient-evidence responses get a distinct UI state |
| [ADR-006](docs/decisions/ADR-006-citation-index-validation.md) | Citation indices validated, with one retry, then fail safe |
| [ADR-007](docs/decisions/ADR-007-per-claim-faithfulness-judge.md) | Faithfulness checked per-claim via LLM judge, decomposed at eval time |
| [ADR-008](docs/decisions/ADR-008-three-way-verdict-scale.md) | Three-way verdict scale: supported / unsupported / contradicted |
| [ADR-009](docs/decisions/ADR-009-offline-faithfulness-eval.md) | Faithfulness checking is offline, not a live query gate |
| [ADR-010](docs/decisions/ADR-010-deterministic-claim-extraction.md) | Claims extracted deterministically from citation markers |
| [ADR-011](docs/decisions/ADR-011-reciprocal-rank-fusion.md) | Reciprocal Rank Fusion for hybrid retrieval |
| [ADR-012](docs/decisions/ADR-012-postgres-full-text-search.md) | Postgres full-text search for the keyword signal |
| [ADR-013](docs/decisions/ADR-013-hand-rolled-rrf-preserves-scores.md) | RRF implemented directly, preserving per-chunk distance |
| [ADR-014](docs/decisions/ADR-014-llm-as-reranker.md) | LLM-as-reranker, not a cross-encoder |
| [ADR-015](docs/decisions/ADR-015-batched-relevance-scoring.md) | Per-candidate batched relevance scoring |
| [ADR-016](docs/decisions/ADR-016-widen-then-narrow-candidates.md) | Candidate pool widened to 10, narrowed to top-4 after reranking |
| [ADR-017](docs/decisions/ADR-017-rerank-fallback-to-fused-order.md) | Incomplete reranker response falls back to fused order |

## Testing

```bash
npm test
```

Runs the vitest suite (`src/lib/matchPercent.test.ts`, `server/lib/synthesize.test.ts`, `server/lib/faithfulness.test.ts`, `server/lib/hybridRetrieve.test.ts`, `server/lib/rerank.test.ts`) — unit tests for score-display conversion, answer-synthesis refusal/citation-validation logic, faithfulness claim extraction/verdict aggregation, RRF fusion math, and rerank scoring/fallback behavior.

```bash
npm run eval:faithfulness
```

A separate, on-demand check (real OpenAI calls, not part of `npm test`) that the faithfulness judge actually discriminates faithful answers from unfaithful ones — runs 3 known-good/known-bad answer pairs through the real judge and reports whether each was scored correctly.
