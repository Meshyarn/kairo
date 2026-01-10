import { describe, expect, it } from "@jest/globals";
import { RustVectorMath } from "../../vector/RustVectorMath.js";

describe("RustVectorMath", () => {
  it("computes cosine scores when native module is available", () => {
    const rustMath = RustVectorMath.getShared();
    if (!rustMath.isAvailable()) {
      return;
    }
    const query = new Float32Array([1, 0]);
    const vectors = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    const scores = rustMath.cosineScores(query, vectors);
    expect(scores.length).toBe(2);
    expect(scores[0]).toBeGreaterThan(0.9);
    expect(scores[1]).toBeLessThan(0.1);
  });
});
