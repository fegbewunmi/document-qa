import { Router, Request, Response } from "express";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import * as dotenv from "dotenv";

dotenv.config({ path: `${process.cwd()}/.env` });

const router = Router();

const dbConfig = {
  host: "localhost",
  port: 5433,
  user: "postgres",
  password: "password",
  database: "ragdb",
};

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small",
});

router.post("/", async (req: Request, res: Response) => {
  const { question } = req.body;

  if (!question) {
    res.status(400).json({ error: "Question is required" });
    return;
  }

  try {
    const vectorStore = await PGVectorStore.initialize(embeddings, {
      postgresConnectionOptions: dbConfig,
      tableName: "documents",
    });

    const results = await vectorStore.similaritySearchWithScore(question, 4);

    const chunks = results.map(([doc, score]) => ({
      text: doc.pageContent,
      score: Math.round(score * 100) / 100,
      metadata: doc.metadata,
    }));

    res.json({ question, chunks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

export default router;
