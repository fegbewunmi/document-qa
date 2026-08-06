import { Router, Request, Response } from "express";
import multer from "multer";
import { Pool } from "pg";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { dbConfig, DOCUMENTS_TABLE } from "../db";
import { ensureFullTextIndex } from "../lib/hybridRetrieve";

const router = Router();

const pool = new Pool(dbConfig);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF files are supported"));
      return;
    }
    cb(null, true);
  },
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-small",
});

// Single-document model: each upload replaces whatever was previously indexed.
async function clearExistingDocuments() {
  try {
    await pool.query(`TRUNCATE TABLE ${DOCUMENTS_TABLE}`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P01") throw err; // ignore "table does not exist" on first-ever upload
  }
}

router.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "A PDF file is required" });
      return;
    }

    try {
      const loader = new PDFLoader(
        new Blob([req.file.buffer], { type: "application/pdf" }),
      );
      const rawDocs = await loader.load();
      const namedDocs = rawDocs.map((doc) => ({
        ...doc,
        metadata: { ...doc.metadata, source: req.file!.originalname },
      }));

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 100,
      });
      const chunks = await splitter.splitDocuments(namedDocs);

      await clearExistingDocuments();

      await PGVectorStore.fromDocuments(chunks, embeddings, {
        postgresConnectionOptions: dbConfig,
        tableName: DOCUMENTS_TABLE,
      });

      await ensureFullTextIndex(pool);

      res.json({
        message: `Ingested ${chunks.length} chunks from ${req.file.originalname}`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Something went wrong" });
    }
  },
);

// Express only recognizes this as error-handling middleware if it declares
// all four parameters, even though `next` is unused here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
router.use((err: Error, _req: Request, res: Response, _next: () => void) => {
  res.status(400).json({ error: err.message });
});

export default router;
