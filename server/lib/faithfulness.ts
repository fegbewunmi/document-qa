import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// See docs/decisions/ADR-007 through ADR-010 for the reasoning behind every
// decision in this file.

export type Verdict = "supported" | "unsupported" | "contradicted";

export interface Claim {
  text: string;
  chunkIndices: number[]; // 1-based, resolved from [n] markers in the answer
}

export interface JudgedClaim extends Claim {
  verdict: Verdict;
}

export interface FaithfulnessResult {
  claims: JudgedClaim[];
  unsupportedClaimRate: number; // (unsupported + contradicted) / total, 0 if no claims
}

const VerdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      claimIndex: z
        .number()
        .int()
        .describe(
          "The 1-based index of the claim being judged, matching the numbered list given in the prompt.",
        ),
      verdict: z
        .enum(["supported", "unsupported", "contradicted"])
        .describe(
          "supported: the cited passage(s) state this. contradicted: the cited passage(s) state the opposite or a different fact. unsupported: the cited passage(s) don't address this claim either way.",
        ),
    }),
  ),
});

export interface FaithfulnessJudgeModel {
  judge(
    claims: { text: string; citedText: string }[],
  ): Promise<{ claimIndex: number; verdict: Verdict }[]>;
}

// Splits on sentence-ending punctuation followed by whitespace or end of string.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9]|$)/;
const CITATION_MARKER_RE = /\[(\d+)\]/g;

export function extractClaims(answer: string, chunkCount: number): Claim[] {
  const sentences = answer
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const claims: Claim[] = [];
  for (const sentence of sentences) {
    const markers = [...sentence.matchAll(CITATION_MARKER_RE)].map((m) =>
      Number(m[1]),
    );
    if (markers.length === 0) continue; // uncited — out of scope, see ADR-010

    const validIndices = [...new Set(markers)].filter(
      (i) => i >= 1 && i <= chunkCount,
    );
    claims.push({ text: sentence, chunkIndices: validIndices });
  }
  return claims;
}

export async function checkFaithfulness(
  answer: string,
  chunks: { text: string }[],
  judge: FaithfulnessJudgeModel,
): Promise<FaithfulnessResult> {
  const claims = extractClaims(answer, chunks.length);
  if (claims.length === 0) {
    return { claims: [], unsupportedClaimRate: 0 };
  }

  const checkable = claims.filter((c) => c.chunkIndices.length > 0);
  const uncheckable = claims.filter((c) => c.chunkIndices.length === 0);

  const verdictByClaim = new Map<Claim, Verdict>();
  for (const c of uncheckable) verdictByClaim.set(c, "unsupported");

  if (checkable.length > 0) {
    const judgeInput = checkable.map((c) => ({
      text: c.text,
      citedText: c.chunkIndices
        .map((i) => chunks[i - 1].text)
        .join("\n---\n"),
    }));

    const verdicts = await judge.judge(judgeInput);
    const verdictByIndex = new Map(
      verdicts.map((v) => [v.claimIndex, v.verdict]),
    );

    checkable.forEach((c, i) => {
      const claimIndex = i + 1;
      const verdict = verdictByIndex.get(claimIndex);
      if (!verdict) {
        console.warn(
          `checkFaithfulness: judge returned no verdict for claim ${claimIndex}, defaulting to unsupported`,
          c.text,
        );
      }
      verdictByClaim.set(c, verdict ?? "unsupported");
    });
  }

  const judgedClaims: JudgedClaim[] = claims.map((c) => ({
    ...c,
    verdict: verdictByClaim.get(c)!,
  }));

  const failed = judgedClaims.filter(
    (c) => c.verdict === "unsupported" || c.verdict === "contradicted",
  ).length;

  return {
    claims: judgedClaims,
    unsupportedClaimRate: failed / judgedClaims.length,
  };
}

export function createOpenAIFaithfulnessJudge(
  apiKey: string | undefined,
): FaithfulnessJudgeModel {
  const chat = new ChatOpenAI({
    openAIApiKey: apiKey,
    model: "gpt-4o-mini",
    temperature: 0,
  }).withStructuredOutput(VerdictsSchema);

  return {
    async judge(claims) {
      const numbered = claims
        .map(
          (c, i) =>
            `Claim ${i + 1}: "${c.text}"\nCited passage(s):\n${c.citedText}`,
        )
        .join("\n\n");

      const result = await chat.invoke([
        {
          role: "system",
          content:
            "You verify whether factual claims are supported by the specific passages cited for them. For each claim, judge ONLY against its own cited passage(s) — ignore outside knowledge. supported: the passage(s) state this. contradicted: the passage(s) state the opposite or a conflicting fact (e.g. a different number, a different cause). unsupported: the passage(s) don't address this claim either way. Return a verdict for every claim listed.",
        },
        { role: "user", content: numbered },
      ]);

      return result.verdicts;
    },
  };
}
