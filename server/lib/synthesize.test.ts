import { describe, expect, it, vi } from "vitest";
import {
  hasValidCitations,
  similarityFromDistance,
  synthesizeAnswer,
  type AnswerResult,
  type RetrievedChunk,
  type StructuredAnswerModel,
} from "./synthesize";

function fakeModel(
  ...responses: AnswerResult[]
): StructuredAnswerModel & { invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn();
  responses.forEach((r) => invoke.mockResolvedValueOnce(r));
  return { invoke };
}

const relevantChunks: RetrievedChunk[] = [
  { text: "Error code E-4471 means a coolant sensor failure.", score: 0.31 },
  { text: "Replacement part SKU is AC-9928-B.", score: 0.4 },
];

describe("similarityFromDistance", () => {
  it("inverts distance into similarity", () => {
    expect(similarityFromDistance(0.31)).toBeCloseTo(0.69);
  });

  it("clamps out-of-range distances into [0, 1]", () => {
    expect(similarityFromDistance(1.5)).toBe(0);
    expect(similarityFromDistance(-0.2)).toBe(1);
  });
});

describe("hasValidCitations", () => {
  it("accepts an empty citation list", () => {
    expect(hasValidCitations([], 3)).toBe(true);
  });

  it("accepts indices within [1, chunkCount]", () => {
    expect(hasValidCitations([1, 2], 2)).toBe(true);
  });

  it("rejects an index beyond chunkCount", () => {
    expect(hasValidCitations([1, 3], 2)).toBe(false);
  });

  it("rejects a zero or negative index", () => {
    expect(hasValidCitations([0], 2)).toBe(false);
    expect(hasValidCitations([-1], 2)).toBe(false);
  });

  it("rejects non-integer indices", () => {
    expect(hasValidCitations([1.5], 2)).toBe(false);
  });
});

describe("synthesizeAnswer", () => {
  it("returns a no-evidence refusal without calling the model when there are no chunks", async () => {
    const model = fakeModel();
    const result = await synthesizeAnswer("What is X?", [], model);

    expect(result.answerable).toBe(false);
    expect(result.citedChunkIndices).toEqual([]);
    expect(model.invoke).not.toHaveBeenCalled();
  });

  it("returns a no-evidence refusal without calling the model when the best match is below the similarity floor", async () => {
    const model = fakeModel();
    const irrelevantChunks: RetrievedChunk[] = [
      { text: "Completely unrelated content.", score: 0.94 },
    ];
    const result = await synthesizeAnswer(
      "What is X?",
      irrelevantChunks,
      model,
    );

    expect(result.answerable).toBe(false);
    expect(model.invoke).not.toHaveBeenCalled();
  });

  it("returns the model's answer directly when citations are valid on the first try", async () => {
    const model = fakeModel({
      answer: "E-4471 is a coolant sensor failure [1], fixed with AC-9928-B [2].",
      citedChunkIndices: [1, 2],
      answerable: true,
    });

    const result = await synthesizeAnswer(
      "What does E-4471 mean?",
      relevantChunks,
      model,
    );

    expect(result.answerable).toBe(true);
    expect(result.citedChunkIndices).toEqual([1, 2]);
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });

  it("retries once and returns the corrected answer when the first response cites an out-of-range index", async () => {
    const model = fakeModel(
      {
        answer: "Bad answer citing a passage that wasn't given [5].",
        citedChunkIndices: [5],
        answerable: true,
      },
      {
        answer: "Corrected answer [1].",
        citedChunkIndices: [1],
        answerable: true,
      },
    );

    const result = await synthesizeAnswer(
      "What does E-4471 mean?",
      relevantChunks,
      model,
    );

    expect(model.invoke).toHaveBeenCalledTimes(2);
    expect(result.citedChunkIndices).toEqual([1]);
    expect(result.answer).toBe("Corrected answer [1].");
  });

  it("falls back to a safe malformed-response refusal if the retry is still invalid", async () => {
    const model = fakeModel(
      { answer: "Bad [9].", citedChunkIndices: [9], answerable: true },
      { answer: "Still bad [9].", citedChunkIndices: [9], answerable: true },
    );

    const result = await synthesizeAnswer(
      "What does E-4471 mean?",
      relevantChunks,
      model,
    );

    expect(model.invoke).toHaveBeenCalledTimes(2);
    expect(result.answerable).toBe(false);
    expect(result.citedChunkIndices).toEqual([]);
  });
});
