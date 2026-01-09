import * as crypto from "crypto";
import type { EmbeddingConfig } from "../../types.js";

export function normalizeSearchQuery(query: string): string {
    return String(query ?? "").trim();
}

export function computePackId(query: string, options: unknown): string {
    const normalized = stableStringify({ query: String(query ?? ""), options });
    return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function stableStringify(value: any): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(v => stableStringify(v)).join(",")}]`;
    }
    if (typeof value === "object") {
        const keys = Object.keys(value).sort();
        const parts = keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
        return `{${parts.join(",")}}`;
    }
    return JSON.stringify(String(value));
}

export function mergeEmbeddingConfig(base: EmbeddingConfig, override: EmbeddingConfig): EmbeddingConfig {
    return {
        ...base,
        ...override,
        local: {
            ...base.local,
            ...override.local
        }
    };
}
