import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// See docs/adr/0001-answer-synthesis.md for the reasoning behind every
// decision in this file.

export const AnswerSchema = z.object({
  answer: z
    .string()
    .describe(
      "Natural language answer to the question, with inline citation markers like [1], [2] referencing the numbered passages they draw from.",
    ),
  citedChunkIndices: z
    .array(z.number().int())
    .describe(
      "The 1-based indices of the passages actually used to support the answer. Empty if answerable is false.",
    ),
  answerable: z
    .boolean()
    .describe(
      "True if the provided passages contain enough information to answer the question; false if they do not.",
    ),
});

export type AnswerResult = z.infer<typeof AnswerSchema>;

export interface RetrievedChunk {
  text: string;
  score: number; // cosine distance from PGVectorStore — lower is more similar
}

export interface StructuredAnswerModel {
  invoke(systemPrompt: string, userPrompt: string): Promise<AnswerResult>;
}

// Placeholder cutoff, not a tuned constant — see ADR 0001, Decision 2.
const MIN_SIMILARITY_TO_ATTEMPT_ANSWER = 0.1;

const NO_EVIDENCE_ANSWER =
  "I couldn't find any information related to this question in the indexed document.";
const MALFORMED_RESPONSE_ANSWER =
  "Something went wrong generating a grounded answer.";

export function similarityFromDistance(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}

export function hasValidCitations(
  indices: number[],
  chunkCount: number,
): boolean {
  return indices.every(
    (i) => Number.isInteger(i) && i >= 1 && i <= chunkCount,
  );
}

function buildSystemPrompt(): string {
  return [
    "You answer questions using ONLY the numbered passages the user provides.",
    "Do not use outside knowledge. Do not fabricate information that is not present in the passages.",
    "Cite the passages that support each claim using bracket markers like [1] or [2] directly in your answer text.",
    "List the 1-based indices of every passage you actually relied on in citedChunkIndices.",
    "If the passages do not contain enough information to answer the question, set answerable to false, leave citedChunkIndices empty, and write a brief answer explaining that no relevant information was found — do not guess.",
  ].join(" ");
}

function buildUserPrompt(question: string, chunks: RetrievedChunk[]): string {
  const passages = chunks
    .map((chunk, i) => `[${i + 1}] ${chunk.text}`)
    .join("\n\n");
  return `Passages:\n${passages}\n\nQuestion: ${question}`;
}

export async function synthesizeAnswer(
  question: string,
  chunks: RetrievedChunk[],
  model: StructuredAnswerModel,
): Promise<AnswerResult> {
  if (chunks.length === 0) {
    return { answer: NO_EVIDENCE_ANSWER, citedChunkIndices: [], answerable: false };
  }

  const bestSimilarity = Math.max(
    ...chunks.map((c) => similarityFromDistance(c.score)),
  );
  if (bestSimilarity < MIN_SIMILARITY_TO_ATTEMPT_ANSWER) {
    return { answer: NO_EVIDENCE_ANSWER, citedChunkIndices: [], answerable: false };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(question, chunks);

  const first = await model.invoke(systemPrompt, userPrompt);
  if (hasValidCitations(first.citedChunkIndices, chunks.length)) {
    return first;
  }

  console.warn(
    "synthesizeAnswer: invalid citedChunkIndices on first attempt",
    first.citedChunkIndices,
    `(valid range 1-${chunks.length})`,
  );

  const correctedPrompt = `${userPrompt}\n\nYour previous answer cited passage indices that don't exist: ${JSON.stringify(first.citedChunkIndices)}. Valid indices are 1 through ${chunks.length}. Answer again using only valid indices.`;
  const retry = await model.invoke(systemPrompt, correctedPrompt);
  if (hasValidCitations(retry.citedChunkIndices, chunks.length)) {
    return retry;
  }

  console.warn(
    "synthesizeAnswer: invalid citedChunkIndices after retry, falling back",
    retry.citedChunkIndices,
    `(valid range 1-${chunks.length})`,
  );
  return { answer: MALFORMED_RESPONSE_ANSWER, citedChunkIndices: [], answerable: false };
}

export function createOpenAIStructuredAnswerModel(
  apiKey: string | undefined,
): StructuredAnswerModel {
  const chat = new ChatOpenAI({
    openAIApiKey: apiKey,
    model: "gpt-4o-mini",
    temperature: 0,
  }).withStructuredOutput(AnswerSchema);

  return {
    async invoke(systemPrompt: string, userPrompt: string) {
      return chat.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
    },
  };
}
