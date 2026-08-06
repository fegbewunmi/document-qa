import * as dotenv from "dotenv";
import {
  checkFaithfulness,
  createOpenAIFaithfulnessJudge,
} from "../server/lib/faithfulness";

dotenv.config({ path: `${process.cwd()}/.env` });

// Real chunk text captured from live /upload + /query testing against
// test-doc.pdf (docs/DESIGN-DOC.md, Evaluation Design). Each case pairs a
// known-faithful answer with a hand-injected unfaithful variant, so this
// script verifies the faithfulness checker actually discriminates — not
// just that it runs. See ADR-008 for why both unsupported and contradicted
// failure modes are exercised, not just one.
const cases = [
  {
    name: "E-4471 error code (unsupported addition)",
    chunkText:
      "If the unit displays error code E-4471, this indicates a coolant pressure sensor failure. Replace the sensor using replacement part SKU AC-9928-B.",
    goodAnswer:
      "Error code E-4471 indicates a coolant pressure sensor failure [1]. The part that fixes it is the replacement sensor with SKU AC-9928-B [1].",
    badAnswer:
      "Error code E-4471 indicates a coolant pressure sensor failure [1]. Replace it within 24 hours to avoid permanent damage to the unit [1].",
    badExpectedVerdict: "unsupported",
  },
  {
    name: "Warranty period (contradicted number)",
    chunkText:
      "The standard warranty period for the Widget X200 is 3 years from the date of purchase, covering parts and labor.",
    goodAnswer:
      "The standard warranty period for the Widget X200 is 3 years, covering parts and labor [1].",
    badAnswer:
      "The standard warranty period for the Widget X200 is 5 years, covering parts and labor [1].",
    badExpectedVerdict: "contradicted",
  },
  {
    name: "Filter maintenance interval (contradicted number)",
    chunkText:
      "Filters should be replaced every 90 days under normal operating conditions.",
    goodAnswer: "Filters should be replaced every 90 days [1].",
    badAnswer: "Filters should be replaced every 30 days [1].",
    badExpectedVerdict: "contradicted",
  },
] as const;

async function main() {
  const judge = createOpenAIFaithfulnessJudge(process.env.OPENAI_API_KEY);
  let allPassed = true;

  for (const c of cases) {
    const chunks = [{ text: c.chunkText }];

    const good = await checkFaithfulness(c.goodAnswer, chunks, judge);
    const bad = await checkFaithfulness(c.badAnswer, chunks, judge);

    const goodPassed = good.unsupportedClaimRate === 0;
    const badFlagged = bad.claims.some((cl) => cl.verdict === c.badExpectedVerdict);

    const casePassed = goodPassed && badFlagged;
    allPassed &&= casePassed;

    console.log(`\n${casePassed ? "PASS" : "FAIL"}: ${c.name}`);
    console.log(
      `  good answer: rate=${good.unsupportedClaimRate.toFixed(2)} verdicts=${good.claims.map((cl) => cl.verdict).join(",")}`,
    );
    console.log(
      `  bad answer:  rate=${bad.unsupportedClaimRate.toFixed(2)} verdicts=${bad.claims.map((cl) => cl.verdict).join(",")} (expected at least one "${c.badExpectedVerdict}")`,
    );
    if (!goodPassed) {
      console.log(`  ✗ the faithful answer was flagged as unfaithful — false positive`);
    }
    if (!badFlagged) {
      console.log(`  ✗ the unfaithful answer was NOT flagged — false negative`);
    }
  }

  console.log(`\n${allPassed ? "All cases discriminated correctly." : "Some cases failed — see above."}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
