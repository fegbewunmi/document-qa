# Document Q&A (RAG Pipeline)

A document Q&A system that lets you query uploaded files using natural language, powered by a retrieval-augmented generation (RAG) pipeline.

## Tech Stack
- React + TypeScript + Vite
- LangChain
- pgvector (PostgreSQL)
- OpenAI API (text-embedding-3-small)

## How it works
1. A document is loaded, split into overlapping chunks, and embedded using OpenAI's embedding model
2. Vectors are stored in PostgreSQL via pgvector
3. At query time, the question is embedded and a cosine similarity search retrieves the most relevant chunks
4. Retrieved chunks are passed as context to the LLM to generate a grounded answer
