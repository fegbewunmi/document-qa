import { describe, expect, it, vi } from "vitest";
import {
  hybridRetrieve,
  reciprocalRankFusion,
  type HybridRetrievalSources,
  type RankedRow,
  type VectorSearchResult,
} from "./hybridRetrieve";

function fakeSources(
  vectorResults: VectorSearchResult[],
  keywordResults: RankedRow[],
  distanceLookup: Record<string, number> = {},
): HybridRetrievalSources & { vectorDistanceForIds: ReturnType<typeof vi.fn> } {
  return {
    vectorSearch: vi.fn().mockResolvedValue(vectorResults),
    keywordSearch: vi.fn().mockResolvedValue(keywordResults),
    vectorDistanceForIds: vi.fn().mockImplementation(async (ids: string[]) => {
      return new Map(ids.map((id) => [id, distanceLookup[id]]));
    }),
  };
}

describe("reciprocalRankFusion", () => {
  it("scores a single ranked list by weight / (rank + c)", () => {
    const scores = reciprocalRankFusion(
      [[{ id: "a" }, { id: "b" }]],
      [1],
      60,
    );
    expect(scores.get("a")).toBeCloseTo(1 / 61);
    expect(scores.get("b")).toBeCloseTo(1 / 62);
  });

  it("sums contributions when an item appears in multiple lists", () => {
    const scores = reciprocalRankFusion(
      [[{ id: "a" }], [{ id: "a" }]],
      [0.5, 0.5],
      60,
    );
    expect(scores.get("a")).toBeCloseTo(0.5 / 61 + 0.5 / 61);
  });

  it("throws if the number of weights doesn't match the number of lists", () => {
    expect(() => reciprocalRankFusion([[{ id: "a" }]], [0.5, 0.5])).toThrow();
  });
});

describe("hybridRetrieve", () => {
  const row = (id: string, text: string): RankedRow => ({
    id,
    text,
    metadata: {},
  });

  it("returns vector-only results in vector order when keyword search finds nothing", async () => {
    const sources = fakeSources(
      [
        { ...row("v1", "first"), distance: 0.1 },
        { ...row("v2", "second"), distance: 0.2 },
      ],
      [],
    );

    const result = await hybridRetrieve(sources, { fusedK: 4 });

    expect(result.map((r) => r.text)).toEqual(["first", "second"]);
    expect(result[0].score).toBe(0.1);
    expect(sources.vectorDistanceForIds).not.toHaveBeenCalled();
  });

  it("surfaces a keyword-only exact match with a real (non-fabricated) distance", async () => {
    const sources = fakeSources(
      [
        { ...row("v1", "semantic match"), distance: 0.1 },
        { ...row("v2", "another"), distance: 0.2 },
      ],
      [row("k1", "exact SKU match")],
      { k1: 0.15 },
    );

    const result = await hybridRetrieve(sources, { fusedK: 3 });

    const keywordChunk = result.find((r) => r.text === "exact SKU match");
    expect(keywordChunk).toBeDefined();
    expect(keywordChunk!.score).toBe(0.15);
    expect(sources.vectorDistanceForIds).toHaveBeenCalledWith(["k1"]);
  });

  it("lets a strong keyword match overtake a vector-only result ranked ahead of it", async () => {
    // "b" ranks 1st in vector alone; "a" ranks 2nd in vector but also 1st in
    // keyword — fusion should place "a" ahead of "b" despite vector's own
    // ranking, which is the whole point of hybrid retrieval.
    const sources = fakeSources(
      [
        { ...row("b", "vector favorite"), distance: 0.05 },
        { ...row("a", "exact identifier match"), distance: 0.06 },
      ],
      [row("a", "exact identifier match")],
      {},
    );

    const result = await hybridRetrieve(sources, { fusedK: 2 });

    expect(result[0].text).toBe("exact identifier match");
    expect(result[1].text).toBe("vector favorite");
  });

  it("truncates to fusedK even when more candidates are available", async () => {
    const sources = fakeSources(
      [
        { ...row("v1", "1"), distance: 0.1 },
        { ...row("v2", "2"), distance: 0.2 },
        { ...row("v3", "3"), distance: 0.3 },
      ],
      [],
    );

    const result = await hybridRetrieve(sources, { fusedK: 2 });
    expect(result).toHaveLength(2);
  });

  it("returns an empty result when neither retriever finds anything", async () => {
    const sources = fakeSources([], []);
    const result = await hybridRetrieve(sources, { fusedK: 4 });
    expect(result).toEqual([]);
  });
});
