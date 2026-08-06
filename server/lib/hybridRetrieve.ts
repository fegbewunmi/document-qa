import { Pool } from "pg";
import { toSql } from "pgvector";
import { DOCUMENTS_TABLE } from "../db";

// See docs/decisions/ADR-011 through ADR-013 for the reasoning behind every
// decision in this file.

export interface RankedRow {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface VectorSearchResult extends RankedRow {
  distance: number;
}

export interface RetrievedChunk {
  text: string;
  metadata: Record<string, unknown>;
  score: number; // real cosine distance — never a fabricated/sentinel value, see ADR-013
}

export interface HybridRetrievalSources {
  vectorSearch(k: number): Promise<VectorSearchResult[]>;
  keywordSearch(k: number): Promise<RankedRow[]>;
  vectorDistanceForIds(ids: string[]): Promise<Map<string, number>>;
}

export const DEFAULT_VECTOR_CANDIDATES = 10;
export const DEFAULT_KEYWORD_CANDIDATES = 10;
export const DEFAULT_FUSED_RESULTS = 4;
export const RRF_C = 60; // matches langchain's EnsembleRetriever default (Cormack et al., 2009)

export function reciprocalRankFusion(
  rankedLists: { id: string }[][],
  weights: number[],
  c: number = RRF_C,
): Map<string, number> {
  if (rankedLists.length !== weights.length) {
    throw new Error(
      "reciprocalRankFusion: rankedLists and weights must be the same length",
    );
  }
  const scores = new Map<string, number>();
  rankedLists.forEach((list, listIndex) => {
    const weight = weights[listIndex];
    list.forEach((item, i) => {
      const rank = i + 1;
      scores.set(item.id, (scores.get(item.id) ?? 0) + weight / (rank + c));
    });
  });
  return scores;
}

export interface HybridRetrieveOptions {
  vectorK?: number;
  keywordK?: number;
  fusedK?: number;
  c?: number;
}

export async function hybridRetrieve(
  sources: HybridRetrievalSources,
  options: HybridRetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const vectorK = options.vectorK ?? DEFAULT_VECTOR_CANDIDATES;
  const keywordK = options.keywordK ?? DEFAULT_KEYWORD_CANDIDATES;
  const fusedK = options.fusedK ?? DEFAULT_FUSED_RESULTS;
  const c = options.c ?? RRF_C;

  const [vectorResults, keywordResults] = await Promise.all([
    sources.vectorSearch(vectorK),
    sources.keywordSearch(keywordK),
  ]);

  const fusedScores = reciprocalRankFusion(
    [vectorResults, keywordResults],
    [0.5, 0.5],
    c,
  );

  const byId = new Map<string, RankedRow>();
  for (const row of [...vectorResults, ...keywordResults]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }

  const rankedIds = [...fusedScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, fusedK)
    .map(([id]) => id);

  const distanceById = new Map(vectorResults.map((r) => [r.id, r.distance]));
  const missingIds = rankedIds.filter((id) => !distanceById.has(id));
  if (missingIds.length > 0) {
    const fetched = await sources.vectorDistanceForIds(missingIds);
    for (const [id, distance] of fetched) distanceById.set(id, distance);
  }

  return rankedIds.map((id) => {
    const row = byId.get(id)!;
    return {
      text: row.text,
      metadata: row.metadata,
      score: distanceById.get(id)!,
    };
  });
}

export function createPgHybridRetrievalSources(
  pool: Pool,
  queryEmbedding: number[],
  question: string,
): HybridRetrievalSources {
  const embeddingSql = toSql(queryEmbedding);

  return {
    async vectorSearch(k) {
      const { rows } = await pool.query(
        `SELECT id, text, metadata, (embedding <=> $1::vector) AS distance
         FROM ${DOCUMENTS_TABLE}
         ORDER BY distance ASC
         LIMIT $2`,
        [embeddingSql, k],
      );
      return rows.map((r) => ({
        id: r.id,
        text: r.text,
        metadata: r.metadata,
        distance: Number(r.distance),
      }));
    },

    async keywordSearch(k) {
      const { rows } = await pool.query(
        `SELECT id, text, metadata
         FROM ${DOCUMENTS_TABLE}
         WHERE to_tsvector('english', text) @@ plainto_tsquery('english', $1)
         ORDER BY ts_rank(to_tsvector('english', text), plainto_tsquery('english', $1)) DESC
         LIMIT $2`,
        [question, k],
      );
      return rows.map((r) => ({ id: r.id, text: r.text, metadata: r.metadata }));
    },

    async vectorDistanceForIds(ids) {
      if (ids.length === 0) return new Map();
      const { rows } = await pool.query(
        `SELECT id, (embedding <=> $1::vector) AS distance
         FROM ${DOCUMENTS_TABLE}
         WHERE id = ANY($2::uuid[])`,
        [embeddingSql, ids],
      );
      return new Map(rows.map((r) => [r.id, Number(r.distance)]));
    },
  };
}

export async function ensureFullTextIndex(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE INDEX IF NOT EXISTS documents_text_fts_idx
     ON ${DOCUMENTS_TABLE}
     USING GIN (to_tsvector('english', text))`,
  );
}
