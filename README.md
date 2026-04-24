# Document Q&A — RAG Pipeline

A full-stack document question-answering app. Upload any PDF and query it using natural language. Relevant passages are retrieved using vector similarity search and returned ranked by relevance score.

**Stack:** React · TypeScript · Node.js · Express · PostgreSQL · pgvector · OpenAI · LangChain

---

## How it works

1. User uploads a PDF via the UI
2. The backend chunks the document and generates embeddings using OpenAI's `text-embedding-3-small` model
3. Embeddings are stored in PostgreSQL using the pgvector extension
4. When a question is submitted, the backend embeds the query and runs a similarity search against stored chunks
5. The top 4 most relevant passages are returned with match scores

---

## Project Structure

```
rag-doc-chat/
├── src/                  # React frontend (Vite + TypeScript)
│   ├── App.tsx
│   └── App.css
├── server/               # Express backend
│   ├── index.ts
│   └── routes/
│       ├── query.ts      # Similarity search endpoint
│       └── upload.ts     # PDF ingestion endpoint
├── scripts/
│   └── ingest.ts         # One-off ingestion script
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
```json
// multipart/form-data
{ "file": "<pdf file>" }

// Response
{ "message": "Ingested 42 chunks from document.pdf" }
```

### POST /query
```json
// Request
{ "question": "What is the main topic of this document?" }

// Response
{
  "question": "What is the main topic of this document?",
  "chunks": [
    {
      "text": "...",
      "score": 0.87,
      "metadata": { "source": "document.pdf" }
    }
  ]
}
```

---

## Key Technical Decisions

- **pgvector over a hosted vector DB** — keeps the stack simple and colocated with relational data, which mirrors real production setups
- **Chunk overlap (100 tokens)** — preserves context across chunk boundaries to improve retrieval quality
- **On-the-fly ingestion** — documents are embedded and stored at upload time, so queries are fast and stateless
- **`text-embedding-3-small`** — balances cost and performance for document retrieval tasks