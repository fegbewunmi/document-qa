import { Router, Request, Response } from "express";
import { Pool } from "pg";
import { OpenAIEmbeddings } from "@langchain/openai";
import { dbConfig } from "../db";
import {
  createOpenAIStructuredAnswerModel,
  synthesizeAnswer,
} from "../lib/synthesize";
import {
  createPgHybridRetrievalSources,
  hybridRetrieve,
} from "../lib/hybridRetrieve";
import { createOpenAIReranker, rerank } from "../lib/rerank";

const router = Router();

// Widened per ADR-016: fusion surfaces more candidates than synthesis sees,
// so reranking has a real chance to promote a chunk fusion ranked outside
// the naive top-4, not just reorder around it.
const RERANK_CANDIDATES = 10;
const FINAL_RESULTS = 4;

const pool = new Pool(dbConfig);

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small",
});

const answerModel = createOpenAIStructuredAnswerModel(
  process.env.OPENAI_API_KEY,
);

const rerankerModel = createOpenAIReranker(process.env.OPENAI_API_KEY);

router.post("/", async (req: Request, res: Response) => {
  const { question } = req.body;

  if (!question) {
    res.status(400).json({ error: "Question is required" });
    return;
  }

  try {
    const queryEmbedding = await embeddings.embedQuery(question);
    const sources = createPgHybridRetrievalSources(
      pool,
      queryEmbedding,
      question,
    );
    const fused = await hybridRetrieve(sources, {
      fusedK: RERANK_CANDIDATES,
    });
    const retrieved = await rerank(
      question,
      fused,
      rerankerModel,
      FINAL_RESULTS,
    );

    const chunks = retrieved.map((chunk) => ({
      text: chunk.text,
      score: Math.round(chunk.score * 100) / 100,
      metadata: chunk.metadata,
    }));

    const { answer, citedChunkIndices, answerable } = await synthesizeAnswer(
      question,
      chunks,
      answerModel,
    );

    res.json({ question, chunks, answer, citedChunkIndices, answerable });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

export default router;
