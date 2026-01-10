import type { CapabilityProvider } from "../EngineManager.js";
import type { IVectorMathProvider } from "../VectorMath.js";

export class JsVectorMathProvider implements CapabilityProvider<IVectorMathProvider> {
    meta = { id: "JsVectorMathProvider", tier: "js" as const, priority: 10 };

    isAvailable(): boolean {
        return true;
    }

    get(): IVectorMathProvider {
        return {
            cosineScores: (query: Float32Array, vectors: Float32Array[]) => {
                const scores: number[] = [];
                const normQ = l2Norm(query);
                if (normQ === 0) {
                    return vectors.map(() => 0);
                }
                for (const vector of vectors) {
                    scores.push(cosineSimilarity(query, vector, normQ));
                }
                return scores;
            }
        };
    }
}

function l2Norm(vector: Float32Array): number {
    let sum = 0;
    for (const v of vector) {
        sum += v * v;
    }
    return Math.sqrt(sum);
}

function cosineSimilarity(query: Float32Array, vector: Float32Array, normQ: number): number {
    let dot = 0;
    let normV = 0;
    const len = Math.min(query.length, vector.length);
    for (let i = 0; i < len; i += 1) {
        const q = query[i];
        const v = vector[i];
        dot += q * v;
        normV += v * v;
    }
    if (normV === 0 || normQ === 0) return 0;
    return dot / (normQ * Math.sqrt(normV));
}
