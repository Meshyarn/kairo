import type { EmbeddingKey } from "./IndexTypes.js";

export function normalizeLikePattern(pattern: string): string {
    const trimmed = pattern.trim().replace(/%/g, "");
    return trimmed.toLowerCase();
}

export function embeddingKey(key: EmbeddingKey): string {
    return `${key.provider}::${key.model}`;
}

export function encodeVector(vector: Float32Array): string {
    const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    return buffer.toString("base64");
}

export function decodeVector(encoded: string): Float32Array {
    const buffer = Buffer.from(encoded, "base64");
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
