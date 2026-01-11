import type { CapabilityProvider } from "../EngineManager.js";
import type { ITokenChunkingProvider, TokenChunkResult } from "../Chunking.js";

export class JsChunkingProvider implements CapabilityProvider<ITokenChunkingProvider> {
    meta = { id: "JsChunkingProvider", tier: "js" as const, priority: 10 };

    isAvailable(): boolean {
        return true;
    }

    get(): ITokenChunkingProvider {
        return {
            chunk: (text: string, maxTokens: number, overlapTokens: number): TokenChunkResult[] =>
                chunkByWhitespaceTokens(text, maxTokens, overlapTokens)
        };
    }
}

type TokenSpan = { start: number; end: number };

function chunkByWhitespaceTokens(text: string, maxTokens: number, overlapTokens: number): TokenChunkResult[] {
    if (maxTokens <= 0) return [];
    const tokens = collectTokens(text);
    if (tokens.length === 0) return [];

    const safeOverlap = Math.max(0, Math.min(overlapTokens, maxTokens - 1));
    const chunks: TokenChunkResult[] = [];
    let startToken = 0;

    while (startToken < tokens.length) {
        const endToken = Math.min(startToken + maxTokens, tokens.length);
        const startByte = tokens[startToken].start;
        const endByte = tokens[endToken - 1].end;
        chunks.push({
            text: text.slice(startByte, endByte),
            startByte,
            endByte,
            startToken,
            endToken
        });
        if (endToken >= tokens.length) {
            break;
        }
        const nextStart = endToken - safeOverlap;
        if (nextStart <= startToken) {
            break;
        }
        startToken = nextStart;
    }

    return chunks;
}

function collectTokens(text: string): TokenSpan[] {
    const tokens: TokenSpan[] = [];
    const regex = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        tokens.push({ start, end: start + match[0].length });
    }
    return tokens;
}
