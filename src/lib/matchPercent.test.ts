import { describe, expect, it } from "vitest";
import { toMatchPercent } from "./matchPercent";

describe("toMatchPercent", () => {
  it("converts a low distance (close match) into a high percentage", () => {
    expect(toMatchPercent(0.31)).toBe(69);
  });

  it("converts a high distance (poor match) into a low percentage", () => {
    expect(toMatchPercent(0.94)).toBe(6);
  });

  it("treats zero distance as a perfect 100% match", () => {
    expect(toMatchPercent(0)).toBe(100);
  });

  it("clamps distances beyond 1 to 0% instead of going negative", () => {
    expect(toMatchPercent(1.5)).toBe(0);
  });

  it("clamps negative distances to 100% instead of exceeding it", () => {
    expect(toMatchPercent(-0.2)).toBe(100);
  });
});
