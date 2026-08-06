import { describe, expect, it, vi } from "vitest";
import { rerank, type RerankCandidate, type RerankerModel } from "./rerank";

function fakeReranker(
  scores: { candidateIndex: number; relevance: number }[],
): RerankerModel & { score: ReturnType<typeof vi.fn> } {
  return { score: vi.fn().mockResolvedValue(scores) };
}

const candidate = (text: string, score = 0.5): RerankCandidate => ({
  text,
  metadata: {},
  score,
});

describe("rerank", () => {
  it("returns an empty array without calling the model when there are no candidates", async () => {
    const model = fakeReranker([]);
    const result = await rerank("question", [], model, 4);

    expect(result).toEqual([]);
    expect(model.score).not.toHaveBeenCalled();
  });

  it("reorders candidates by relevance score, descending", async () => {
    const candidates = [
      candidate("low relevance"),
      candidate("high relevance"),
      candidate("medium relevance"),
    ];
    const model = fakeReranker([
      { candidateIndex: 1, relevance: 2 },
      { candidateIndex: 2, relevance: 9 },
      { candidateIndex: 3, relevance: 5 },
    ]);

    const result = await rerank("question", candidates, model, 3);

    expect(result.map((c) => c.text)).toEqual([
      "high relevance",
      "medium relevance",
      "low relevance",
    ]);
  });

  it("promotes a candidate ranked outside the pre-rerank top-K once scored highest", async () => {
    // Simulates the exact case reranking exists for: a fused candidate list
    // where the truly best answer isn't in the naive top slots.
    const candidates = [
      candidate("fused rank 1, but not actually the answer"),
      candidate("fused rank 2, tangential"),
      candidate("fused rank 3, tangential"),
      candidate("fused rank 4, the actual answer"),
    ];
    const model = fakeReranker([
      { candidateIndex: 1, relevance: 3 },
      { candidateIndex: 2, relevance: 1 },
      { candidateIndex: 3, relevance: 1 },
      { candidateIndex: 4, relevance: 10 },
    ]);

    const result = await rerank("question", candidates, model, 2);

    expect(result[0].text).toBe("fused rank 4, the actual answer");
    expect(result).toHaveLength(2);
  });

  it("truncates to topK after scoring the full candidate set", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const model = fakeReranker([
      { candidateIndex: 1, relevance: 1 },
      { candidateIndex: 2, relevance: 2 },
      { candidateIndex: 3, relevance: 3 },
    ]);

    const result = await rerank("question", candidates, model, 1);

    expect(model.score).toHaveBeenCalledWith(
      "question",
      candidates.map((c) => ({ text: c.text, metadata: c.metadata, score: c.score })),
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("c");
  });

  it("falls back to the original fused order, unmodified, when a candidate is left unscored", async () => {
    const candidates = [candidate("first"), candidate("second"), candidate("third")];
    const model = fakeReranker([
      { candidateIndex: 1, relevance: 1 },
      { candidateIndex: 3, relevance: 9 },
      // no score for candidateIndex 2 — an incomplete response
    ]);

    const result = await rerank("question", candidates, model, 3);

    expect(result.map((c) => c.text)).toEqual(["first", "second", "third"]);
  });

  it("still respects topK when falling back to the original order", async () => {
    const candidates = [candidate("first"), candidate("second"), candidate("third")];
    const model = fakeReranker([{ candidateIndex: 1, relevance: 5 }]);

    const result = await rerank("question", candidates, model, 2);

    expect(result.map((c) => c.text)).toEqual(["first", "second"]);
  });
});
