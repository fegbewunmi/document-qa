import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// See docs/decisions/ADR-014 through ADR-017 for the reasoning behind every
// decision in this file.

export interface RerankCandidate {
  text: string;
  metadata: Record<string, unknown>;
  score: number; // fused cosine distance from hybridRetrieve — untouched by reranking
}

const RelevanceScoresSchema = z.object({
  scores: z.array(
    z.object({
      candidateIndex: z
        .number()
        .int()
        .describe(
          "The 1-based index of the candidate being scored, matching the numbered list given in the prompt.",
        ),
      relevance: z
        .number()
        .describe(
          "0-10: how well this candidate answers the question. 10 = directly and precisely answers it. 0 = completely irrelevant.",
        ),
    }),
  ),
});

export interface RerankerModel {
  score(
    question: string,
    candidates: { text: string }[],
  ): Promise<{ candidateIndex: number; relevance: number }[]>;
}

export async function rerank(
  question: string,
  candidates: RerankCandidate[],
  model: RerankerModel,
  topK: number,
): Promise<RerankCandidate[]> {
  if (candidates.length === 0) return [];

  const results = await model.score(question, candidates);
  const relevanceByIndex = new Map(
    results.map((r) => [r.candidateIndex, r.relevance]),
  );

  const allScored = candidates.every((_, i) => relevanceByIndex.has(i + 1));
  if (!allScored) {
    console.warn(
      "rerank: reranker did not return a score for every candidate — falling back to the original fused order",
      { requested: candidates.length, scored: results.length },
    );
    return candidates.slice(0, topK);
  }

  return candidates
    .map((candidate, i) => ({
      candidate,
      relevance: relevanceByIndex.get(i + 1)!,
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, topK)
    .map((r) => r.candidate);
}

export function createOpenAIReranker(
  apiKey: string | undefined,
): RerankerModel {
  const chat = new ChatOpenAI({
    openAIApiKey: apiKey,
    model: "gpt-4o-mini",
    temperature: 0,
  }).withStructuredOutput(RelevanceScoresSchema);

  return {
    async score(question, candidates) {
      const numbered = candidates
        .map((c, i) => `Candidate ${i + 1}: "${c.text}"`)
        .join("\n\n");

      const result = await chat.invoke([
        {
          role: "system",
          content:
            "You score how relevant each numbered candidate passage is to answering the question, on a 0-10 scale. 10 means the passage directly and precisely answers the question. 0 means it's completely irrelevant. Score every candidate listed, even if none of them are a strong match.",
        },
        { role: "user", content: `Question: ${question}\n\n${numbered}` },
      ]);

      return result.scores;
    },
  };
}
