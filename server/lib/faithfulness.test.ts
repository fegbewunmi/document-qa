import { describe, expect, it, vi } from "vitest";
import {
  checkFaithfulness,
  extractClaims,
  type FaithfulnessJudgeModel,
  type Verdict,
} from "./faithfulness";

function fakeJudge(
  verdicts: { claimIndex: number; verdict: Verdict }[],
): FaithfulnessJudgeModel & { judge: ReturnType<typeof vi.fn> } {
  const judge = vi.fn().mockResolvedValue(verdicts);
  return { judge };
}

describe("extractClaims", () => {
  it("extracts one claim per cited sentence with its chunk index", () => {
    const claims = extractClaims(
      "The sensor failed [1]. Replace it with part AC-9928-B [2].",
      2,
    );
    expect(claims).toEqual([
      { text: "The sensor failed [1].", chunkIndices: [1] },
      { text: "Replace it with part AC-9928-B [2].", chunkIndices: [2] },
    ]);
  });

  it("skips sentences with no citation marker", () => {
    const claims = extractClaims(
      "Here is what I found. The warranty is 3 years [1].",
      1,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].text).toBe("The warranty is 3 years [1].");
  });

  it("collects multiple distinct markers on one sentence", () => {
    const claims = extractClaims("This spans two passages [1][2].", 2);
    expect(claims[0].chunkIndices).toEqual([1, 2]);
  });

  it("dedupes a repeated marker on one sentence", () => {
    const claims = extractClaims("Repeated citation [1][1].", 2);
    expect(claims[0].chunkIndices).toEqual([1]);
  });

  it("drops out-of-range markers, leaving an empty chunkIndices array", () => {
    const claims = extractClaims("Citing a passage that doesn't exist [9].", 2);
    expect(claims[0].chunkIndices).toEqual([]);
  });

  it("returns no claims for an answer with zero citations", () => {
    expect(extractClaims("I don't know.", 4)).toEqual([]);
  });
});

describe("checkFaithfulness", () => {
  const chunks = [
    { text: "The coolant sensor fails and causes error E-4471." },
    { text: "The warranty covers parts and labor for 3 years." },
  ];

  it("returns zero rate and no claims when the answer has no citations", async () => {
    const judge = fakeJudge([]);
    const result = await checkFaithfulness("I don't know.", chunks, judge);

    expect(result.claims).toEqual([]);
    expect(result.unsupportedClaimRate).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it("computes a 0 rate when every claim is supported", async () => {
    const judge = fakeJudge([{ claimIndex: 1, verdict: "supported" }]);
    const result = await checkFaithfulness(
      "The sensor fails and causes E-4471 [1].",
      chunks,
      judge,
    );

    expect(result.unsupportedClaimRate).toBe(0);
    expect(result.claims[0].verdict).toBe("supported");
  });

  it("counts both unsupported and contradicted claims as failures", async () => {
    const judge = fakeJudge([
      { claimIndex: 1, verdict: "supported" },
      { claimIndex: 2, verdict: "contradicted" },
      { claimIndex: 3, verdict: "unsupported" },
    ]);
    const answer =
      "The sensor fails and causes E-4471 [1]. The warranty is 5 years [2]. Replace it every 24 hours [2].";
    const result = await checkFaithfulness(answer, chunks, judge);

    expect(result.unsupportedClaimRate).toBeCloseTo(2 / 3);
  });

  it("marks a claim with only out-of-range citations as unsupported without asking the judge", async () => {
    const judge = fakeJudge([]);
    const answer = "This cites a passage that was never given [9].";
    const result = await checkFaithfulness(answer, chunks, judge);

    expect(result.claims[0].verdict).toBe("unsupported");
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it("defaults to unsupported when the judge omits a verdict for a claim", async () => {
    const judge = fakeJudge([]); // judge returns nothing for the one claim asked about
    const answer = "The sensor fails and causes E-4471 [1].";
    const result = await checkFaithfulness(answer, chunks, judge);

    expect(result.claims[0].verdict).toBe("unsupported");
    expect(result.unsupportedClaimRate).toBe(1);
  });

  it("only sends checkable claims to the judge, skipping out-of-range ones", async () => {
    const judge = fakeJudge([{ claimIndex: 1, verdict: "supported" }]);
    const answer =
      "This cites a passage that was never given [9]. The sensor fails and causes E-4471 [1].";
    await checkFaithfulness(answer, chunks, judge);

    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(judge.judge).toHaveBeenCalledWith([
      { text: "The sensor fails and causes E-4471 [1].", citedText: chunks[0].text },
    ]);
  });
});
