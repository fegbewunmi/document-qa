import * as dotenv from "dotenv";
import type { PoolConfig } from "pg";

dotenv.config({ path: `${process.cwd()}/.env` });

export const dbConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
};

export const DOCUMENTS_TABLE = "documents";
