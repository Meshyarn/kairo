import { describe, expect, it, afterEach } from "@jest/globals";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_VECTOR_COSINE_BATCH } from "../../orchestration/capabilities/CapabilityIds.js";

describe("RustVectorMath", () => {
  afterEach(() => {
    EngineManager.resetForTesting();
  });

  it("computes cosine scores via registered provider", () => {
    EngineManager.resetForTesting();
    EngineManager.registerProvider(CAP_VECTOR_COSINE_BATCH, {
      meta: { id: "RustVectorMathTestProvider", tier: "js", priority: 1000 },
      isAvailable: () => true,
      get: () => ({
        cosineScores: (query: Float32Array, vectors: Float32Array[]) => {
          const scores: number[] = [];
          for (const vector of vectors) {
            const dot = query[0] * vector[0] + query[1] * vector[1];
            const queryMag = Math.hypot(query[0], query[1]);
            const vecMag = Math.hypot(vector[0], vector[1]);
            scores.push(dot / (queryMag * vecMag));
          }
          return scores;
        }
      })
    });
    const provider = EngineManager.getProvider<{ cosineScores: (q: Float32Array, v: Float32Array[]) => number[] }>(
      CAP_VECTOR_COSINE_BATCH
    );
    expect(provider).not.toBeNull();
    const query = new Float32Array([1, 0]);
    const vectors = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    const scores = provider!.cosineScores(query, vectors);
    expect(scores.length).toBe(2);
    expect(scores[0]).toBeGreaterThan(0.9);
    expect(scores[1]).toBeLessThan(0.1);
  });
});
