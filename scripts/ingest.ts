import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { PoolConfig } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: `${process.cwd()}/.env` });

console.log("DB URL:", process.env.DATABASE_URL);
// dotenv.config();

async function ingest() {
  console.log("Loading PDF...");
  // database config
  const dbConfig: PoolConfig = {
    connectionString: process.env.DATABASE_URL,
  };

  //   const dbConfig = {
  //     host: "localhost",
  //     port: 5432,
  //     user: "postgres",
  //     password: "password",
  //     database: "ragdb",
  //   };
  //LOADING THE PDF
  const loader = new PDFLoader("document.pdf");
  const rawDocs = await loader.load();
  console.log(`Loaded ${rawDocs.length} pages`);

  //CHUNKING
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
  });

  const chunks = await splitter.splitDocuments(rawDocs);

  console.log(`Created ${chunks.length} chunks`);

  console.log("Generating embeddings and storing in pgvector...");
  //EMBEDDING
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-small",
  });

  //STORING
  await PGVectorStore.fromDocuments(chunks, embeddings, {
    postgresConnectionOptions: dbConfig,
    tableName: "documents",
  });
  console.log("Done! Your document is indexed and ready to query.");
}

ingest().catch(console.error);
